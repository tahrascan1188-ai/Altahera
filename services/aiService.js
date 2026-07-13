// services/aiService.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('./supabaseService');

const DEFAULT_API_KEY = process.env.GEMINI_API_KEY || '';
const DEFAULT_SYSTEM_INSTRUCTION = `أنت المنسق الطبي ومساعد خدمة العملاء الذكي لـ "مركز الطاهرة للتحاليل والأشعة". وظيفتك هي الرد على استفسارات المرضى والعملاء عبر واتساب بأسلوب مهذب، ودود، واحترافي.

عند إجابة المرضى، يرجى الالتزام بالتعليمات التالية:
1. الرد باللغة العربية الفصحى المبسطة أو العامية المصرية المهذبة الودودة (على سبيل المثال: "أهلاً بك يا فندم"، "تحت أمرك"، "نورتنا").
2. الإجابة بدقة بالاعتماد على أسعار الفحوصات والتحاليل وشروطها المرفقة معك. لا تقم بتأليف أسعار أو مواعيد أو شروط من عندك مطلقاً.
3. إذا طلب المريض فحصاً غير موجود في قاعدة البيانات المرفقة، أخبره بلطف أن هذا الفحص غير مدرج حالياً وسيقوم موظف خدمة العملاء بالرد عليك فوراً.
4. اعرض أسعار التحاليل/الأشعة المطلوبة بشكل واضح ومنسق، واذكر أي شروط خاصة بها (مثل الصيام لعدد ساعات معين، أو الحضور في أيام محددة).
5. كن مختصراً وواضحاً، وتجنب الإطالة غير المفيدة، ولا تذكر للمريض أي تفاصيل تقنية حول الذكاء الاصطناعي أو قاعدة البيانات.`;

// Smart matching logic (fetches tests from Supabase PostgreSQL)
async function findMatchingTests(text) {
    if (!text) return [];
    const query = text.toLowerCase();
    
    // Fetch tests from Supabase
    const { data: tests, error } = await supabase
        .from('tests')
        .select('*');
        
    if (error || !tests || tests.length === 0) return [];
    
    const stopWords = ['سعر', 'تحليل', 'اشعة', 'اشعه', 'بكم', 'يا', 'لو', 'عايز', 'اعرف', 'عن', 'فى', 'في', 'من', 'شروط', 'تعليمات', 'هو', 'هي', 'حجز', 'موعد', 'تفاصيل', 'طلب', 'عمل'];
    const words = query.split(/[\s,._-]+/).filter(w => w.length > 2 && !stopWords.includes(w));
    
    if (words.length === 0) {
        return tests.filter(t => {
            const nameAr = (t.name_ar || '').toLowerCase();
            const nameEn = (t.name_en || '').toLowerCase();
            return nameAr.includes(query) || nameEn.includes(query);
        });
    }

    return tests.filter(t => {
        const nameAr = (t.name_ar || '').toLowerCase();
        const nameEn = (t.name_en || '').toLowerCase();
        return words.some(word => nameAr.includes(word) || nameEn.includes(word));
    });
}

// Generate content with failover key rotation
async function generateReply(messageBody, mediaData, mimeType) {
    // 1. Fetch AI Settings from Supabase
    let settings = null;
    try {
        const { data, error } = await supabase
            .from('ai_settings')
            .select('*')
            .single();
        if (!error && data) {
            settings = data;
        }
    } catch (dbErr) {
        console.warn('⚠️ Failed to fetch AI settings from database, using defaults:', dbErr.message);
    }

    const keys = [
        settings ? settings.api_key_1 : null,
        settings ? settings.api_key_2 : null,
        settings ? settings.api_key_3 : null
    ].map(k => k ? k.trim() : null);

    // Use default API key if no keys are configured
    if (!keys[0] && !keys[1] && !keys[2]) {
        keys[0] = DEFAULT_API_KEY;
    }

    const activeIndex = (settings && settings.active_key_index) || 1; // 1-indexed
    const systemInstruction = (settings && settings.system_instruction) || DEFAULT_SYSTEM_INSTRUCTION;

    // Determine matching tests for prompt context
    const matchingTests = await findMatchingTests(messageBody);
    
    const systemPrompt = `
التعليمات الخاصة بك (System Instructions):
${systemInstruction}

قاعدة بيانات التحاليل والأشعة المتاحة بالمركز والمطابقة لاستفسار المريض:
${matchingTests.length > 0 ? JSON.stringify(matchingTests, null, 2) : 'لم يتم العثور على فحوصات مطابقة في قاعدة البيانات.'}

ملاحظة هامة جداً للالتزام بها:
1. يجب الالتزام بالأسعار والتعليمات المذكورة في الجدول أعلاه فقط بشكل حرفي!
2. إذا لم تجد التحليل أو الفحص المطلوب في الجدول، أخبر المريض بلطف أنك لم تجد هذا الفحص في قاعدة البيانات وسيتم الرد عليه من قبل الموظف المختص فوراً. لا تقم أبداً بتأليف أسعار أو تعليمات أو شروط من رأسك!
3. إذا أرسل المريض صورة روشتة تحتوي على فحوصات متعددة، قم بفحص الصورة، ثم ابحث عن أسعار كل فحص منها واعرض أسعارها وتعليماتها المذكورة فقط.
4. أجب باللغة العربية الفصحى أو العامية المهذبة بأسلوب ودود واحترافي كمنسق طبي بالمركز.
5. لا تشرح للمريض كيف يعمل الذكاء الاصطناعي أو تذكر كلمة "جدول مطابقة" أو "قاعدة بيانات".

الرسالة الحالية للمريض: "${messageBody || ''}"
`;

    let attemptIndex = activeIndex;
    let lastError = null;

    for (let k = 0; k < 3; k++) {
        const apiKey = keys[attemptIndex - 1];
        if (!apiKey) {
            // Key is empty, rotate to the next one
            attemptIndex = (attemptIndex % 3) + 1;
            continue;
        }

        console.log(`🤖 Attempting Gemini AI generation with Key #${attemptIndex}...`);
        try {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

            let result;
            if (mediaData) {
                result = await model.generateContent([
                    systemPrompt,
                    { inlineData: { data: mediaData, mimeType: mimeType } }
                ]);
            } else {
                result = await model.generateContent(systemPrompt);
            }

            const responseText = result.response.text().trim();
            console.log(`✅ Gemini AI generation succeeded with Key #${attemptIndex}.`);

            // If we successfully rotated key, update the database
            if (attemptIndex !== activeIndex) {
                try {
                    await supabase
                        .from('ai_settings')
                        .update({ active_key_index: attemptIndex })
                        .eq('id', 1);
                    console.log(`💾 Updated active API Key index to #${attemptIndex} in database.`);
                } catch (dbErr) {
                    console.warn(`⚠️ Failed to update active key index in database:`, dbErr.message);
                }
            }

            return responseText;
        } catch (err) {
            console.warn(`⚠️ Gemini Key #${attemptIndex} failed:`, err.message);
            lastError = err;

            // Rotate key index to the next one
            attemptIndex = (attemptIndex % 3) + 1;
        }
    }

    throw new Error(`All Gemini API keys failed. Last error: ${lastError ? lastError.message : 'No valid keys configured'}`);
}

module.exports = {
    generateReply,
    findMatchingTests
};
