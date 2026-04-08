/* eslint-disable */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, ShieldAlert, Heart, ArrowRight, Loader2, Sparkles,
  Copy, Download, RefreshCw, CheckCircle2, ClipboardList,
  AlertCircle, FileText, LogIn, LogOut, Lock
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { cn } from './lib/utils';
import { TRANSLATIONS } from './types';
import { analyzeExperience, AnalysisResult, OutputLanguage } from './services/gemini';
import { auth, signInWithGoogle, signOutUser, onAuthStateChanged, type User } from './firebase';

type UILanguage = 'EN' | 'AR' | 'HI' | 'UR';

const RTL_LANGUAGES: UILanguage[] = ['AR', 'UR'];

const LANGUAGE_OPTIONS: { code: UILanguage; label: string; nativeLabel: string }[] = [
  { code: 'EN', label: 'English', nativeLabel: 'English' },
  { code: 'AR', label: 'Arabic', nativeLabel: 'العربية' },
  { code: 'HI', label: 'Hindi', nativeLabel: 'हिंदी' },
  { code: 'UR', label: 'Urdu', nativeLabel: 'اردو' },
];

const OUTPUT_LANGUAGE_OPTIONS: { code: OutputLanguage; label: string; description: string }[] = [
  { code: 'EN', label: 'English', description: 'Preferred by doctors in written reports worldwide' },
  { code: 'AR', label: 'العربية', description: 'مع المصطلحات الطبية الإنجليزية بين قوسين' },
  { code: 'HI', label: 'हिंदी', description: 'डॉक्टर के लिए हिंदी में रिपोर्ट' },
  { code: 'UR', label: 'اردو', description: 'ڈاکٹر کے لیے اردو میں رپورٹ' },
];

export default function App() {
  const [uiLanguage, setUiLanguage] = useState<UILanguage>('EN');
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>('EN');
  const [screen, setScreen] = useState<
    'DISCLAIMER' | 'WELCOME' | 'INTAKE' | 'DEMOGRAPHICS' | 'MEDICAL_HISTORY' | 'OUTPUT_LANGUAGE' | 'ANALYSIS' | 'RESULTS'
  >('DISCLAIMER');

  const [userData, setUserData] = useState({
    intakeText: '',
    age: '',
    seenDoctorBefore: false,
    doctorFindings: '',
    interviewAnswers: {} as Record<string, string>
  });

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [showLangDropdown, setShowLangDropdown] = useState(false);

  const resultsRef = useRef<HTMLDivElement>(null);

  const t = TRANSLATIONS[uiLanguage];
  const isRTL = RTL_LANGUAGES.includes(uiLanguage);

  useEffect(() => {
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = uiLanguage.toLowerCase();
  }, [uiLanguage, isRTL]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Sign in error:', error);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleStart = () => setScreen('INTAKE');

  const handleBack = () => {
    if (screen === 'INTAKE') setScreen('WELCOME');
    else if (screen === 'DEMOGRAPHICS') setScreen('INTAKE');
    else if (screen === 'MEDICAL_HISTORY') setScreen('DEMOGRAPHICS');
    else if (screen === 'OUTPUT_LANGUAGE') setScreen('MEDICAL_HISTORY');
    else if (screen === 'ANALYSIS') {
      if (currentStepIndex > 0) {
        const prevIndex = currentStepIndex - 1;
        const prevCategory = analysisResult?.steps[prevIndex].category;
        const prevAnswer = prevCategory ? userData.interviewAnswers[prevCategory] : '';
        setCurrentStepIndex(prevIndex);
        setCurrentAnswer(prevAnswer || '');
      } else {
        setScreen('OUTPUT_LANGUAGE');
      }
    }
  };

  const handleIntakeSubmit = async () => {
    if (!userData.intakeText.trim()) return;
    setIsAnalyzing(true);
    setScreen('ANALYSIS');
    const msgs = {
      EN: 'Analyzing initial symptoms...',
      AR: 'جاري تحليل الأعراض الأولية...',
      HI: 'प्रारंभिक लक्षणों का विश्लेषण हो रहा है...',
      UR: 'ابتدائی علامات کا تجزیہ ہو رہا ہے...',
    };
    setLoadingMessage(msgs[uiLanguage]);

    try {
      const result = await analyzeExperience({
        intakeText: userData.intakeText,
        age: userData.age,
        seenDoctorBefore: userData.seenDoctorBefore,
        doctorFindings: userData.doctorFindings,
      }, uiLanguage, outputLanguage);
      setAnalysisResult(result);
      setCurrentStepIndex(0);
      setCurrentAnswer('');
    } catch (error) {
      console.error(error);
      setScreen('OUTPUT_LANGUAGE');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleNextStep = async () => {
    if (!analysisResult) return;

    const updatedAnswers = {
      ...userData.interviewAnswers,
      [analysisResult.steps[currentStepIndex].category]: currentAnswer
    };
    setUserData(prev => ({ ...prev, interviewAnswers: updatedAnswers }));

    if (currentStepIndex < analysisResult.steps.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
      setCurrentAnswer('');
    } else {
      setIsAnalyzing(true);
      const msgs = {
        EN: 'Preparing detailed clinical report...',
        AR: 'جاري إعداد التقرير السريري المفصل...',
        HI: 'विस्तृत नैदानिक रिपोर्ट तैयार हो रही है...',
        UR: 'تفصیلی طبی رپورٹ تیار ہو رہی ہے...',
      };
      setLoadingMessage(msgs[uiLanguage]);
      try {
        const finalResult = await analyzeExperience({
          intakeText: userData.intakeText,
          age: userData.age,
          interviewAnswers: updatedAnswers,
          seenDoctorBefore: userData.seenDoctorBefore,
          doctorFindings: userData.doctorFindings,
        }, uiLanguage, outputLanguage);

        setAnalysisResult(finalResult);
        setScreen('RESULTS');
      } catch (error) {
        console.error(error);
      } finally {
        setIsAnalyzing(false);
      }
    }
  };

  const handleQuickTap = (suggestion: string) => setCurrentAnswer(suggestion);

  const handleDownloadPDF = async () => {
    if (!resultsRef.current) return;
    setIsDownloading(true);
    try {
      const original = resultsRef.current;
      const clone = original.cloneNode(true) as HTMLElement;
      clone.style.position = 'absolute';
      clone.style.left = '-9999px';
      clone.style.top = '0';
      clone.style.width = original.offsetWidth + 'px';
      clone.style.backgroundColor = '#ffffff';
      clone.style.color = '#000000';
      const allElements = clone.querySelectorAll('*');
      allElements.forEach((el) => {
        const element = el as HTMLElement;
        element.style.color = '#000000';
        element.style.borderColor = '#000000';
        element.style.fill = '#000000';
        const bg = window.getComputedStyle(element).backgroundColor;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
          element.style.backgroundColor = '#ffffff';
        }
      });
      document.body.appendChild(clone);
      const canvas = await html2canvas(clone, {
        scale: 2,
        backgroundColor: '#FFFFFF',
        useCORS: true,
        logging: false,
        allowTaint: true,
      });
      document.body.removeChild(clone);
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [canvas.width / 2, canvas.height / 2]
      });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height / canvas.width) * pdfWidth;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save('Clara_Medical_Report.pdf');
    } catch (error) {
      console.error("PDF generation failed:", error);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopyToClipboard = () => {
    if (!analysisResult) return;
    const { guidance, clinicalReport } = analysisResult;
    const text = `CLARA CLINICAL REPORT\n\n` +
      `[GUIDANCE]\nUrgency: ${guidance.urgency}\nTips: ${guidance.tips.join(', ')}\n\n` +
      `[CLINICAL RECORD]\n${clinicalReport.narrative}\n\n` +
      clinicalReport.summaryTable.map(item => `${item.label}: ${item.value}`).join('\n') +
      (currentUser
        ? `\n\nQuestions for Doctor:\n` + clinicalReport.doctorQuestions.join('\n')
        : '');
    navigator.clipboard.writeText(text).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const urgencyColors = {
    Green: 'bg-green-100 text-green-800 border-green-400',
    Yellow: 'bg-yellow-100 text-yellow-800 border-yellow-400',
    Red: 'bg-red-100 text-red-800 border-red-400',
  };

  return (
    <div className="min-h-screen bg-[#FDF6F6] flex flex-col text-[#353D2D]">
      {/* ───── NAVBAR ───── */}
      <nav className="p-4 flex items-center bg-white/50 backdrop-blur-md border-b border-[#F3F4F6] sticky top-0 z-50">
        {/* Logo — left */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Heart className="w-6 h-6 text-[#CF7E7E] fill-[#CF7E7E]" />
          <span className="font-bold text-lg tracking-tight">CLARA</span>
        </div>

        {/* Google Auth — always centered */}
        <div className="flex-1 flex justify-center">
          {currentUser ? (
            <div className="flex items-center gap-2 bg-[#F4F7F2] rounded-full px-4 py-2">
              <CheckCircle2 className="w-4 h-4 text-[#7D9168]" />
              <span className="text-sm font-bold text-[#617250] max-w-[140px] truncate">
                {currentUser.displayName || currentUser.email}
              </span>
              <button
                onClick={signOutUser}
                className="ml-1 text-[#9CAF88] hover:text-[#617250] transition-colors"
                title={t.auth.signOut}
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleGoogleSignIn}
              disabled={isSigningIn}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-[#E5E7EB] text-sm font-medium hover:bg-[#FDF6F6] transition-all disabled:opacity-50"
            >
              {isSigningIn
                ? <Loader2 className="w-4 h-4 animate-spin text-[#CF7E7E]" />
                : <LogIn className="w-4 h-4 text-[#CF7E7E]" />
              }
              {isSigningIn ? t.auth.signingIn : t.auth.signIn}
            </button>
          )}
        </div>

        {/* Language selector — right */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowLangDropdown(prev => !prev)}
            className="flex items-center gap-2 px-3 py-2 rounded-full bg-white border border-[#E5E7EB] text-sm font-medium hover:bg-[#F3F4F6] transition-all"
          >
            <Globe className="w-4 h-4" />
            <span>{uiLanguage}</span>
          </button>
          <AnimatePresence>
            {showLangDropdown && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                className={cn(
                  "absolute top-full mt-2 bg-white border border-[#E5E7EB] rounded-2xl shadow-xl overflow-hidden z-50 min-w-[150px]",
                  isRTL ? "left-0" : "right-0"
                )}
              >
                {LANGUAGE_OPTIONS.map(lang => (
                  <button
                    key={lang.code}
                    onClick={() => {
                      setUiLanguage(lang.code);
                      setShowLangDropdown(false);
                    }}
                    className={cn(
                      "w-full px-4 py-3 text-sm font-medium text-left hover:bg-[#F4F7F2] transition-colors flex items-center gap-3",
                      uiLanguage === lang.code && "bg-[#F4F7F2] font-bold text-[#617250]",
                      RTL_LANGUAGES.includes(lang.code) && "text-right"
                    )}
                  >
                    {uiLanguage === lang.code && <CheckCircle2 className="w-3.5 h-3.5 text-[#7D9168] flex-shrink-0" />}
                    <span>{lang.nativeLabel}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

      {/* Backdrop for dropdown */}
      {showLangDropdown && (
        <div className="fixed inset-0 z-40" onClick={() => setShowLangDropdown(false)} />
      )}

      {/* ───── MAIN ───── */}
      <main className="flex-grow flex items-center justify-center p-4 md:p-8">
        <AnimatePresence mode="wait">

          {/* DISCLAIMER */}
          {screen === 'DISCLAIMER' && (
            <motion.div key="disclaimer" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="max-w-md w-full bg-white rounded-[2.5rem] p-10 shadow-xl border border-[#F3F4F6] text-center">
              <div className="w-20 h-20 bg-[#FBECEC] rounded-full flex items-center justify-center mx-auto mb-8">
                <ShieldAlert className="w-10 h-10 text-[#CF7E7E]" />
              </div>
              <h1 className="text-2xl font-bold mb-4">{t.disclaimer.title}</h1>
              <p className="text-[#617250] mb-10 leading-relaxed">{t.disclaimer.text}</p>
              <button onClick={() => setScreen('WELCOME')}
                className="w-full py-5 bg-[#7D9168] text-white rounded-2xl font-bold hover:bg-[#617250] transition-all flex items-center justify-center gap-3 shadow-lg shadow-[#D3DFCC]">
                {t.disclaimer.button}
                <ArrowRight className={cn("w-5 h-5", isRTL && "rotate-180")} />
              </button>
            </motion.div>
          )}

          {/* WELCOME */}
          {screen === 'WELCOME' && (
            <motion.div key="welcome" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }}
              className="max-w-md w-full text-center">
              <div className="relative w-40 h-40 mx-auto mb-10">
                <div className="absolute inset-0 bg-[#F7DADA] rounded-full blur-3xl opacity-40 animate-pulse" />
                <div className="relative w-full h-full bg-white rounded-full shadow-2xl flex items-center justify-center border-8 border-[#FDF6F6]">
                  <Heart className="w-20 h-20 text-[#CF7E7E]" />
                </div>
              </div>
              <h1 className="text-4xl font-bold mb-4 tracking-tight">{t.welcome.title}</h1>
              <p className="text-lg text-[#617250] mb-6 leading-relaxed">{t.welcome.subtitle}</p>
              {/* Free input hint */}
              <div className="bg-[#F4F7F2] rounded-2xl px-5 py-3 mb-10 text-sm font-medium text-[#617250]">
                {t.welcome.freeInputHint}
              </div>
              <button onClick={handleStart}
                className="w-full py-5 bg-[#CF7E7E] text-white rounded-full font-bold text-xl hover:bg-[#B85F5F] transition-all shadow-2xl shadow-[#F7DADA]">
                {t.welcome.button}
              </button>
            </motion.div>
          )}

          {/* INTAKE — first screen, before demographics */}
          {screen === 'INTAKE' && (
            <motion.div key="intake" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="max-w-2xl w-full">
              <h1 className="text-3xl font-bold mb-3 text-center">{t.intake.title}</h1>
              <p className="text-center text-sm text-[#9CAF88] mb-6">{t.welcome.freeInputHint}</p>
              <div className="bg-white rounded-[2.5rem] p-8 shadow-2xl border border-[#F3F4F6]">
                <textarea
                  value={userData.intakeText}
                  onChange={(e) => setUserData(prev => ({ ...prev, intakeText: e.target.value }))}
                  placeholder={t.intake.placeholder}
                  className="w-full min-h-[250px] bg-transparent border-none focus:ring-0 text-xl placeholder-[#B8CCAA] resize-none"
                />
                <div className="flex justify-between items-center mt-4">
                  <button onClick={handleBack}
                    className="px-8 py-4 bg-white text-[#353D2D] border-2 border-[#E9EFE5] rounded-2xl font-bold hover:bg-[#F3F4F6] transition-all">
                    {t.analysis.back}
                  </button>
                  <button onClick={() => setScreen('DEMOGRAPHICS')} disabled={!userData.intakeText.trim()}
                    className={cn("px-10 py-4 rounded-2xl font-bold transition-all flex items-center gap-3",
                      userData.intakeText.trim()
                        ? "bg-[#353D2D] text-white hover:bg-black"
                        : "bg-[#E9EFE5] text-[#B8CCAA] cursor-not-allowed"
                    )}>
                    {t.analysis.next}
                    <ArrowRight className={cn("w-5 h-5", isRTL && "rotate-180")} />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* DEMOGRAPHICS */}
          {screen === 'DEMOGRAPHICS' && (
            <motion.div key="demographics" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="max-w-md w-full bg-white rounded-[2.5rem] p-10 shadow-xl border border-[#F3F4F6] text-center">
              <div className="w-20 h-20 bg-[#F4F7F2] rounded-full flex items-center justify-center mx-auto mb-8">
                <ClipboardList className="w-10 h-10 text-[#7D9168]" />
              </div>
              <h1 className="text-2xl font-bold mb-8">{t.demographics.title}</h1>
              <div className="space-y-6">
                <input
                  type="number"
                  value={userData.age}
                  onChange={(e) => setUserData(prev => ({ ...prev, age: e.target.value }))}
                  placeholder={t.demographics.ageLabel}
                  className="w-full p-5 bg-[#FDF6F6] rounded-2xl border-2 border-[#F7DADA] text-center text-2xl font-bold focus:ring-2 focus:ring-[#CF7E7E] focus:border-transparent"
                />
                <div className="flex gap-4">
                  <button onClick={handleBack}
                    className="flex-1 py-5 bg-white text-[#353D2D] border-2 border-[#E9EFE5] rounded-2xl font-bold hover:bg-[#F3F4F6] transition-all">
                    {t.analysis.back}
                  </button>
                  <button onClick={() => setScreen('MEDICAL_HISTORY')} disabled={!userData.age}
                    className={cn("flex-[2] py-5 rounded-2xl font-bold transition-all flex items-center justify-center gap-3 shadow-lg",
                      userData.age
                        ? "bg-[#CF7E7E] text-white hover:bg-[#B85F5F] shadow-[#F7DADA]"
                        : "bg-[#E9EFE5] text-[#B8CCAA] cursor-not-allowed"
                    )}>
                    {t.demographics.button}
                    <ArrowRight className={cn("w-5 h-5", isRTL && "rotate-180")} />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* MEDICAL HISTORY */}
          {screen === 'MEDICAL_HISTORY' && (
            <motion.div key="medical" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="max-w-md w-full bg-white rounded-[2.5rem] p-10 shadow-xl border border-[#F3F4F6] text-center">
              <div className="w-20 h-20 bg-[#F4F7F2] rounded-full flex items-center justify-center mx-auto mb-8">
                <ClipboardList className="w-10 h-10 text-[#7D9168]" />
              </div>
              <h1 className="text-2xl font-bold mb-8">{t.medical.title}</h1>
              <p className="text-[#617250] mb-6 font-medium">{t.medical.doctorQuestion}</p>
              <div className="flex gap-4 mb-6">
                <button onClick={() => setUserData(prev => ({ ...prev, seenDoctorBefore: true }))}
                  className={cn("flex-1 py-4 rounded-2xl font-bold border-2 transition-all",
                    userData.seenDoctorBefore
                      ? "bg-[#7D9168] border-[#7D9168] text-white"
                      : "bg-white border-[#E9EFE5] text-[#353D2D] hover:border-[#9CAF88]"
                  )}>
                  {t.medical.yes}
                </button>
                <button onClick={() => setUserData(prev => ({ ...prev, seenDoctorBefore: false, doctorFindings: '' }))}
                  className={cn("flex-1 py-4 rounded-2xl font-bold border-2 transition-all",
                    !userData.seenDoctorBefore
                      ? "bg-[#CF7E7E] border-[#CF7E7E] text-white"
                      : "bg-white border-[#E9EFE5] text-[#353D2D] hover:border-[#CF7E7E]"
                  )}>
                  {t.medical.no}
                </button>
              </div>
              {userData.seenDoctorBefore && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                  <p className="text-[#617250] mb-3 font-medium text-sm">{t.medical.findingsLabel}</p>
                  <textarea
                    value={userData.doctorFindings}
                    onChange={(e) => setUserData(prev => ({ ...prev, doctorFindings: e.target.value }))}
                    placeholder={t.medical.findingsPlaceholder}
                    className="w-full min-h-[120px] p-4 bg-[#F4F7F2] rounded-2xl border-none focus:ring-2 focus:ring-[#9CAF88] text-base resize-none"
                  />
                </motion.div>
              )}
              <div className="flex gap-4">
                <button onClick={handleBack}
                  className="flex-1 py-5 bg-white text-[#353D2D] border-2 border-[#E9EFE5] rounded-2xl font-bold hover:bg-[#F3F4F6] transition-all">
                  {t.analysis.back}
                </button>
                <button onClick={() => setScreen('OUTPUT_LANGUAGE')}
                  className="flex-[2] py-5 bg-[#CF7E7E] text-white rounded-2xl font-bold hover:bg-[#B85F5F] transition-all flex items-center justify-center gap-3 shadow-lg shadow-[#F7DADA]">
                  {t.medical.button}
                  <ArrowRight className={cn("w-5 h-5", isRTL && "rotate-180")} />
                </button>
              </div>
            </motion.div>
          )}

          {/* OUTPUT LANGUAGE SELECTION */}
          {screen === 'OUTPUT_LANGUAGE' && (
            <motion.div key="output-lang" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="max-w-md w-full bg-white rounded-[2.5rem] p-10 shadow-xl border border-[#F3F4F6] text-center">
              <div className="w-20 h-20 bg-[#FBECEC] rounded-full flex items-center justify-center mx-auto mb-8">
                <Globe className="w-10 h-10 text-[#CF7E7E]" />
              </div>
              <h1 className="text-2xl font-bold mb-2">{t.outputLanguage.title}</h1>
              <p className="text-[#617250] text-sm mb-8">{t.outputLanguage.subtitle}</p>
              <div className="space-y-3 mb-8">
                {OUTPUT_LANGUAGE_OPTIONS.map(lang => (
                  <button
                    key={lang.code}
                    onClick={() => setOutputLanguage(lang.code)}
                    className={cn(
                      "w-full p-4 rounded-2xl border-2 text-left transition-all",
                      outputLanguage === lang.code
                        ? "bg-[#F4F7F2] border-[#7D9168] text-[#353D2D]"
                        : "bg-white border-[#E9EFE5] text-[#617250] hover:border-[#9CAF88]"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-lg">{lang.label}</span>
                      {outputLanguage === lang.code && <CheckCircle2 className="w-5 h-5 text-[#7D9168]" />}
                    </div>
                    <p className="text-xs mt-1 opacity-70">{lang.description}</p>
                  </button>
                ))}
              </div>
              <div className="flex gap-4">
                <button onClick={handleBack}
                  className="flex-1 py-5 bg-white text-[#353D2D] border-2 border-[#E9EFE5] rounded-2xl font-bold hover:bg-[#F3F4F6] transition-all">
                  {t.analysis.back}
                </button>
                <button onClick={handleIntakeSubmit}
                  className="flex-[2] py-5 bg-[#CF7E7E] text-white rounded-2xl font-bold hover:bg-[#B85F5F] transition-all flex items-center justify-center gap-3 shadow-lg shadow-[#F7DADA]">
                  {t.analysis.next}
                  <ArrowRight className={cn("w-5 h-5", isRTL && "rotate-180")} />
                </button>
              </div>
            </motion.div>
          )}

          {/* ANALYSIS */}
          {screen === 'ANALYSIS' && (
            <motion.div key="analysis" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl w-full">
              {isAnalyzing ? (
                <div className="flex flex-col items-center py-20">
                  <Loader2 className="w-16 h-16 text-[#CF7E7E] animate-spin mb-6" />
                  <h2 className="text-2xl font-bold text-[#353D2D]">{loadingMessage}</h2>
                </div>
              ) : analysisResult && (
                <div className="space-y-8">
                  <div className="w-full bg-[#E9EFE5] h-2 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${((currentStepIndex + 1) / analysisResult.steps.length) * 100}%` }}
                      className="h-full bg-[#7D9168]"
                    />
                  </div>

                  <div className="bg-white rounded-[2.5rem] p-10 shadow-2xl border border-[#F3F4F6]">
                    <div className="flex items-center gap-3 mb-6 text-[#9CAF88] font-bold uppercase tracking-widest text-sm">
                      <Sparkles className="w-5 h-5" />
                      {analysisResult.steps[currentStepIndex].category}
                    </div>
                    <h2 className="text-3xl font-bold mb-10 leading-tight">
                      {analysisResult.steps[currentStepIndex].question}
                    </h2>

                    {currentStepIndex === analysisResult.steps.length - 1 ? (
                      <textarea
                        value={currentAnswer}
                        onChange={(e) => setCurrentAnswer(e.target.value)}
                        placeholder={t.analysis.precisionPlaceholder}
                        className="w-full min-h-[200px] p-6 bg-[#F4F7F2] rounded-3xl border-none focus:ring-2 focus:ring-[#9CAF88] text-lg"
                      />
                    ) : (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                          {analysisResult.steps[currentStepIndex].suggestions.map((suggestion, idx) => (
                            <button key={idx} onClick={() => handleQuickTap(suggestion)}
                              className={cn("p-5 rounded-2xl border-2 text-left font-medium transition-all",
                                currentAnswer === suggestion
                                  ? "bg-[#7D9168] border-[#7D9168] text-white"
                                  : "bg-white border-[#E9EFE5] text-[#4C593F] hover:border-[#9CAF88]"
                              )}>
                              {suggestion}
                            </button>
                          ))}
                        </div>
                        <input
                          type="text"
                          value={currentAnswer}
                          onChange={(e) => setCurrentAnswer(e.target.value)}
                          placeholder={t.analysis.precisionPlaceholder}
                          className="w-full p-6 bg-[#F4F7F2] rounded-2xl border-none focus:ring-2 focus:ring-[#9CAF88] text-lg"
                        />
                      </div>
                    )}

                    <div className="flex justify-between items-center mt-10">
                      <button onClick={handleBack}
                        className="px-8 py-4 bg-white text-[#353D2D] border-2 border-[#E9EFE5] rounded-2xl font-bold hover:bg-[#F3F4F6] transition-all">
                        {t.analysis.back}
                      </button>
                      <button onClick={handleNextStep} disabled={!currentAnswer.trim()}
                        className={cn("px-12 py-5 rounded-2xl font-bold transition-all flex items-center gap-3",
                          currentAnswer.trim()
                            ? "bg-[#353D2D] text-white hover:bg-black"
                            : "bg-[#E9EFE5] text-[#B8CCAA] cursor-not-allowed"
                        )}>
                        {currentStepIndex === analysisResult.steps.length - 1 ? t.analysis.finish : t.analysis.next}
                        <ArrowRight className={cn("w-5 h-5", isRTL && "rotate-180")} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* RESULTS */}
          {screen === 'RESULTS' && analysisResult && (
            <motion.div key="results" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="max-w-3xl w-full space-y-10">

              <div ref={resultsRef} className="bg-white p-10 border-[3px] border-black text-black font-sans leading-relaxed">
                {/* Header */}
                <div className="border-b-[3px] border-black pb-6 mb-8 flex justify-between items-end">
                  <div>
                    <h1 className="text-3xl font-black uppercase tracking-tighter mb-1">{t.results.title}</h1>
                    <p className="text-xs font-bold uppercase tracking-[0.2em]">{t.results.footer}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold">{new Date().toLocaleDateString()}</p>
                    <p className="text-[10px] font-bold uppercase">Official Clinical Document</p>
                  </div>
                </div>

                {/* Part 1: Guidance */}
                <div className="mb-10">
                  <h2 className="text-xl font-black uppercase border-b-2 border-black mb-4 pb-1">
                    {uiLanguage === 'AR' ? 'التوجيه والاحتمالات الطبية' : 'Guidance & Possibilities'}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <p className="text-[10px] font-black uppercase mb-2">Urgency Level</p>
                      <div className={cn(
                        "inline-block border-2 px-4 py-2 font-black uppercase text-sm mb-4",
                        urgencyColors[analysisResult.guidance.urgency] || "border-black"
                      )}>
                        {analysisResult.guidance.urgency}
                      </div>
                      <p className="text-[10px] font-black uppercase mb-2">Clinical Tips</p>
                      <ul className="space-y-2">
                        {analysisResult.guidance.tips.map((tip, i) => (
                          <li key={i} className="text-sm font-bold flex gap-2">
                            <span>•</span> {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase mb-2">Potential Conditions</p>
                      <div className="space-y-3">
                        {analysisResult.guidance.potentialConditions.map((cond, i) => (
                          <div key={i} className="border border-black p-3">
                            <p className="font-black text-sm uppercase">{cond.name}</p>
                            <p className="text-xs font-medium leading-tight">{cond.explanation}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Part 2: Narrative */}
                <div className="mb-10">
                  <h2 className="text-xl font-black uppercase border-b-2 border-black mb-4 pb-1">
                    {uiLanguage === 'AR' ? 'السجل السريري المفصل' : 'Detailed Clinical Record'}
                  </h2>
                  <div className="border-2 border-black p-6 text-lg font-bold leading-relaxed bg-[#F9FAF9]">
                    {analysisResult.clinicalReport.narrative}
                  </div>
                </div>

                {/* Part 3: Summary Table */}
                <div className="mb-10">
                  <h2 className="text-xl font-black uppercase border-b-2 border-black mb-4 pb-1">
                    {uiLanguage === 'AR' ? 'ملخص البيانات السريرية' : 'Clinical Data Summary'}
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 border-l-2 border-t-2 border-black">
                    {analysisResult.clinicalReport.summaryTable.map((item, i) => (
                      <div key={i} className="border-r-2 border-b-2 border-black p-4">
                        <p className="text-[10px] font-black uppercase mb-1">{item.label}</p>
                        <p className="font-black text-sm">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Part 4: Doctor Questions — locked for guests */}
                <div>
                  <h2 className="text-xl font-black uppercase border-b-2 border-black mb-4 pb-1">
                    {t.results.doctorQuestions}
                  </h2>
                  {currentUser ? (
                    <div className="space-y-2">
                      {analysisResult.clinicalReport.doctorQuestions.map((q, i) => (
                        <div key={i} className="flex gap-4 items-start border-b border-black/20 pb-2">
                          <span className="font-black text-sm">{i + 1}.</span>
                          <p className="font-bold text-sm">{q}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-[#CF7E7E] rounded-2xl p-6 text-center">
                      <Lock className="w-8 h-8 text-[#CF7E7E] mx-auto mb-3" />
                      <p className="font-bold text-[#353D2D] mb-1">{t.results.doctorQuestionsLocked}</p>
                      <p className="text-xs text-[#9CAF88]">{t.auth.unlockPrompt}</p>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="mt-12 pt-6 border-t-[3px] border-black text-center">
                  <p className="text-[10px] font-black uppercase tracking-[0.5em]">{t.results.footer}</p>
                </div>
              </div>

              {/* Sign-in banner for guests — below results */}
              {!currentUser && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className="bg-[#FDF6F6] border-2 border-[#CF7E7E] rounded-2xl p-6 flex flex-col gap-4 text-center">
                  <p className="font-bold text-[#353D2D]">
                    🔒 {t.auth.unlockPrompt}
                  </p>
                  <button onClick={handleGoogleSignIn} disabled={isSigningIn}
                    className="flex items-center justify-center gap-3 bg-white border-2 border-[#CF7E7E] text-[#353D2D] py-4 rounded-2xl font-black hover:bg-[#FDF6F6] transition-all disabled:opacity-50">
                    {isSigningIn
                      ? <Loader2 className="w-5 h-5 animate-spin" />
                      : <LogIn className="w-5 h-5 text-[#CF7E7E]" />
                    }
                    {t.auth.signIn}
                  </button>
                </motion.div>
              )}

              {/* Actions */}
              <div className="space-y-6">
                <div className="bg-white rounded-2xl p-6 border-2 border-black flex items-center gap-4">
                  <AlertCircle className="w-6 h-6 text-black flex-shrink-0" />
                  <p className="text-sm font-bold text-black">{t.results.captureInstruction}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button onClick={handleCopyToClipboard}
                    className="flex items-center justify-center gap-3 bg-white text-black border-2 border-black py-5 rounded-2xl font-black uppercase tracking-wider hover:bg-gray-100 transition-all">
                    {isCopied ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5" />}
                    {isCopied ? t.results.copied : t.results.copy}
                  </button>
                  <button onClick={handleDownloadPDF} disabled={isDownloading}
                    className="flex items-center justify-center gap-3 bg-black text-white py-5 rounded-2xl font-black uppercase tracking-wider hover:bg-gray-900 transition-all disabled:opacity-50">
                    {isDownloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
                    {t.results.downloadPDF}
                  </button>
                </div>
                <button onClick={() => {
                  setScreen('WELCOME');
                  setAnalysisResult(null);
                  setUserData({ intakeText: '', age: '', seenDoctorBefore: false, doctorFindings: '', interviewAnswers: {} });
                }}
                  className="w-full py-5 bg-gray-200 text-black rounded-2xl font-black uppercase tracking-wider hover:bg-gray-300 transition-all flex items-center justify-center gap-3">
                  <RefreshCw className="w-5 h-5" />
                  {t.results.new}
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>
    </div>
  );
}
