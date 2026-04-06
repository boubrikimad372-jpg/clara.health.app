import { Language, Screen, UserData } from './lib/utils';

export interface AppState {
  language: Language;
  screen: Screen;
  userData: UserData;
}

export const INITIAL_STATE: AppState = {
  language: 'EN',
  screen: 'DISCLAIMER',
  userData: {
    agreedToTerms: false,
    intakeText: '',
    seenDoctorBefore: false,
  },
};

export const TRANSLATIONS = {
  EN: {
    disclaimer: {
      title: "Medical Symptom Documentation",
      text: "This tool helps you document symptoms for your doctor. It is not a diagnostic tool and does not replace professional medical advice. I am responsible for my health decisions.",
      button: "I Understand and Agree",
    },
    welcome: {
      title: "Your Medical Communication Assistant",
      subtitle: "Helping you describe your symptoms with professional precision to present them to your doctor.",
      button: "Start Description Now",
    },
    intake: {
      title: "Initial Symptom Description",
      placeholder: "Please describe your primary symptoms and their onset...",
      button: "Continue to Detailed Analysis",
      voiceHint: "I can also use my voice",
    },
    demographics: {
      title: "Could you tell me your age, please?",
      ageLabel: "My age is...",
      button: "Continue",
    },
    medical: {
      title: "My Medical History",
      doctorQuestion: "Have you seen a doctor before for this?",
      yes: "Yes, I have",
      no: "No, I haven't",
      findingsLabel: "Thank you for sharing. What did the doctor find?",
      findingsPlaceholder: "I was told that...",
      button: "Analyze Details",
    },
    analysis: {
      loading: "Processing clinical details...",
      title: "Follow-up Details",
      next: "Next",
      finish: "See Final Report",
      back: "Back",
      step: "Step",
      of: "of",
      precisionPlaceholder: "Type your answer here...",
    },
    results: {
      title: "Official Medical Symptom Report",
      doctorQuestions: "Physician's Diagnostic Checklist",
      copy: "Copy to Clipboard",
      downloadPDF: "Download Medical Report (PDF)",
      new: "Start New Assessment",
      copied: "Copied!",
      captureInstruction: "💡 You can now download the official PDF report to share with your doctor.",
      footer: "CLARA - CLINICAL ASSISTANT",
    },
    toggle: "العربية",
  },
  AR: {
    disclaimer: {
      title: "توثيق الأعراض الطبية",
      text: "هذه الأداة تساعدكِ على توثيق أعراضكِ لعرضها على الطبيب. هي ليست أداة تشخيصية ولا تحل محل الاستشارة الطبية المتخصصة. أنا مسؤولة عن قراراتي الصحية.",
      button: "أوافق وأبدأ التوصيف",
    },
    welcome: {
      title: "مساعدكِ للتواصل الطبي",
      subtitle: "أداة ذكية لمساعدتكِ في وصف أعراضكِ بدقة وتقديمها لطبيبكِ.",
      button: "ابدئي التقييم الآن",
    },
    intake: {
      title: "التوصيف الأولي للأعراض",
      placeholder: "يرجى وصف الأعراض الأساسية وتوقيت ظهورها...",
      button: "المتابعة للتحليل التفصيلي",
      voiceHint: "يمكنني أيضاً استخدام صوتي",
    },
    demographics: {
      title: "كم تبلغين من العمر؟",
      ageLabel: "عمري هو...",
      button: "متابعة",
    },
    medical: {
      title: "تاريخي الطبي",
      doctorQuestion: "هل سبق وأن استشرتِ طبيباً بشأن هذه الأعراض؟",
      yes: "نعم، فعلت",
      no: "لا، لم أفعل",
      findingsLabel: "شكراً لمشاركتكِ. ما الذي وجده الطبيب؟",
      findingsPlaceholder: "قيل لي أن...",
      button: "تحليل التفاصيل",
    },
    analysis: {
      loading: "جاري معالجة التفاصيل السريرية...",
      title: "متابعة التفاصيل",
      next: "التالي",
      finish: "رؤية التقرير النهائي",
      back: "رجوع",
      step: "الخطوة",
      of: "من",
      precisionPlaceholder: "اكتبي إجابتكِ هنا...",
    },
    results: {
      title: "التقرير الطبي الرسمي للأعراض",
      doctorQuestions: "قائمة مراجعة الطبيب التشخيصية",
      copy: "نسخ إلى الحافظة",
      downloadPDF: "تحميل التقرير الطبي (PDF)",
      new: "بدء تقييم جديد",
      copied: "تم النسخ!",
      captureInstruction: "💡 يمكنك الآن تحميل التقرير الطبي الرسمي بصيغة PDF لمشاركته مع طبيبك.",
      footer: "CLARA - CLINICAL ASSISTANT",
    },
    toggle: "English",
  }
};
