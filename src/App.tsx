/* eslint-disable */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, ShieldAlert, Heart, ArrowRight, Loader2, Sparkles,
  Copy, RefreshCw, CheckCircle2, ClipboardList,
  AlertCircle, FileText, LogIn, LogOut, Lock, Shield, Trash2
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { cn } from './lib/utils';
import { TRANSLATIONS } from './types';
import { analyzeStructured, streamNarrative, AnalysisResult, OutputLanguage } from './services/gemini';
import { auth, signInWithGoogle, signOutUser, onAuthStateChanged, type User } from './firebase';

// ─── Types ────────────────────────────────────────────────────────────────────
type UILanguage = 'EN' | 'AR' | 'HI' | 'UR';
const RTL_LANGUAGES: UILanguage[] = ['AR', 'UR'];

const LANGUAGE_OPTIONS: { code: UILanguage; nativeLabel: string }[] = [
  { code: 'EN', nativeLabel: 'English' },
  { code: 'AR', nativeLabel: 'العربية' },
  { code: 'HI', nativeLabel: 'हिंदी' },
  { code: 'UR', nativeLabel: 'اردو' },
];

const OUTPUT_LANGUAGE_OPTIONS: { code: OutputLanguage; label: string; description: string }[] = [
  { code: 'EN', label: 'English', description: 'Preferred by doctors in written reports worldwide' },
  { code: 'AR', label: 'العربية', description: 'مع المصطلحات الطبية الإنجليزية بين قوسين' },
  { code: 'HI', label: 'हिंदी', description: 'डॉक्टर के लिए हिंदी में रिपोर्ट' },
  { code: 'UR', label: 'اردو', description: 'ڈاکٹر کے لیے اردو میں رپورٹ' },
];

// ─── Rotating loading messages per language ────────────────────────────────
const LOADING_MESSAGES: Record<UILanguage, string[]> = {
  EN: [
    'Reading your description carefully...',
    'Identifying key symptoms...',
    'Preparing personalized questions...',
    'Almost ready...',
  ],
  AR: [
    'أقرأ وصفكِ بعناية...',
    'أحدد الأعراض الرئيسية...',
    'أجهّز أسئلة مخصصة لحالتكِ...',
    'على وشك الانتهاء...',
  ],
  HI: [
    'आपका विवरण ध्यान से पढ़ रही हूँ...',
    'मुख्य लक्षण पहचान रही हूँ...',
    'व्यक्तिगत प्रश्न तैयार हो रहे हैं...',
    'लगभग तैयार...',
  ],
  UR: [
    'آپ کی تفصیل غور سے پڑھ رہی ہوں...',
    'اہم علامات پہچان رہی ہوں...',
    'ذاتی سوالات تیار ہو رہے ہیں...',
    'تقریباً تیار...',
  ],
};

// ─── Fake progress hook ───────────────────────────────────────────────────────
function useFakeProgress(active: boolean): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!active) { setProgress(0); return; }
    setProgress(0);
    const steps = [
      { target: 28, delay: 300 },
      { target: 50, delay: 1400 },
      { target: 68, delay: 3000 },
      { target: 80, delay: 5000 },
      { target: 88, delay: 7500 },
      { target: 93, delay: 10000 },
    ];
    const timers = steps.map(({ target, delay }) =>
      setTimeout(() => setProgress(target), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [active]);
  return progress;
}

// ─── Rotating message hook ────────────────────────────────────────────────────
function useRotatingMessage(active: boolean, messages: string[], intervalMs = 2200): string {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!active) { setIdx(0); return; }
    const timer = setInterval(() => {
      setIdx(prev => (prev + 1 < messages.length ? prev + 1 : prev));
    }, intervalMs);
    return () => clearInterval(timer);
  }, [active, messages, intervalMs]);
  return messages[idx] ?? messages[0];
}

// ─── Shimmer primitive ────────────────────────────────────────────────────────
function Shimmer({ className }: { className?: string }) {
  return (
    <motion.div
      animate={{ backgroundPosition: ['200% 0', '-200% 0'] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
      className={cn(
        "rounded-2xl",
        "bg-gradient-to-r from-[#F3F4F6] via-[#E4EBE0] to-[#F3F4F6] bg-[length:200%_100%]",
        className
      )}
    />
  );
}

// ─── Skeleton question card ───────────────────────────────────────────────────
function SkeletonQuestionCard() {
  return (
    <div className="bg-white rounded-[2.5rem] p-10 shadow-2xl border border-[#F3F4F6] space-y-8">
      <Shimmer className="h-4 w-28" />
      <div className="space-y-3">
        <Shimmer className="h-9 w-full" />
        <Shimmer className="h-9 w-2/3" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => <Shimmer key={i} className="h-20" />)}
      </div>
      <Shimmer className="h-14 w-full rounded-2xl" />
      <div className="flex justify-between gap-4">
        <Shimmer className="h-14 w-28 rounded-2xl" />
        <Shimmer className="h-14 w-40 rounded-2xl" />
      </div>
    </div>
  );
}

// ─── Privacy badge ────────────────────────────────────────────────────────────
function PrivacyBadge({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[#617250] text-xs font-semibold">
      <Shield className="w-3.5 h-3.5 text-[#7D9168]" strokeWidth={2.5} />
      <span>{label}</span>
    </div>
  );
}

// ─── Streaming cursor ─────────────────────────────────────────────────────────
function StreamCursor() {
  return (
    <motion.span
      animate={{ opacity: [1, 0] }}
      transition={{ duration: 0.5, repeat: Infinity, repeatType: 'reverse' }}
      className="inline-block w-0.5 h-5 bg-[#7D9168] ml-0.5 align-middle"
    />
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [uiLanguage, setUiLanguage] = useState<UILanguage>('EN');
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>('EN');
  const [screen, setScreen] = useState<
    'DISCLAIMER' | 'WELCOME' | 'INTAKE' | 'DEMOGRAPHICS' | 'MEDICAL_HISTORY' | 'ANALYSIS' | 'RESULTS'
  >('DISCLAIMER');

  const [userData, setUserData] = useState({
    intakeText: '',
    age: '',
    seenDoctorBefore: false,
    doctorFindings: '',
    interviewAnswers: {} as Record<string, string>,
  });

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [isOutputLangStep, setIsOutputLangStep] = useState(false);

  const [streamedNarrative, setStreamedNarrative] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const [isCopied, setIsCopied] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [autoDelete, setAutoDelete] = useState(false);
  const [dataDeleted, setDataDeleted] = useState(false);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [showLangDropdown, setShowLangDropdown] = useState(false);

  const resultsRef = useRef<HTMLDivElement>(null);
  const t = TRANSLATIONS[uiLanguage];
  const isRTL = RTL_LANGUAGES.includes(uiLanguage);

  // Skeleton loading hooks
  const fakeProgress = useFakeProgress(isAnalyzing);
  const rotatingMsg = useRotatingMessage(isAnalyzing, LOADING_MESSAGES[uiLanguage]);

  useEffect(() => {
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = uiLanguage.toLowerCase();
  }, [uiLanguage, isRTL]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => setCurrentUser(user));
    return () => unsub();
  }, []);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    try { await signInWithGoogle(); }
    catch (e) { console.error(e); }
    finally { setIsSigningIn(false); }
  };

  // ─── Navigation ────────────────────────────────────────────────────────────
  const handleBack = () => {
    if (screen === 'INTAKE') setScreen('WELCOME');
    else if (screen === 'DEMOGRAPHICS') setScreen('INTAKE');
    else if (screen === 'MEDICAL_HISTORY') setScreen('DEMOGRAPHICS');
    else if (screen === 'ANALYSIS') {
      if (isOutputLangStep) {
        setIsOutputLangStep(false);
        if (analysisResult) setCurrentStepIndex(analysisResult.steps.length - 1);
      } else if (currentStepIndex > 0) {
        const prev = currentStepIndex - 1;
        const prevCat = analysisResult?.steps[prev].category;
        setCurrentStepIndex(prev);
        setCurrentAnswer(prevCat ? userData.interviewAnswers[prevCat] || '' : '');
      } else {
        setScreen('MEDICAL_HISTORY');
        setAnalysisResult(null);
      }
    }
  };

  // ─── Initial structured call ───────────────────────────────────────────────
  const handleIntakeSubmit = async () => {
    if (!userData.intakeText.trim()) return;
    setIsAnalyzing(true);
    setScreen('ANALYSIS');
    try {
      const result = await analyzeStructured(
        { intakeText: userData.intakeText, age: userData.age, seenDoctorBefore: userData.seenDoctorBefore, doctorFindings: userData.doctorFindings },
        uiLanguage, outputLanguage
      );
      setAnalysisResult(result);
      setCurrentStepIndex(0);
      setCurrentAnswer('');
      setIsOutputLangStep(false);
    } catch (err) {
      console.error(err);
      setScreen('MEDICAL_HISTORY');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ─── Step through questions ─────────────────────────────────────────────────
  const handleNextStep = async () => {
    if (!analysisResult) return;
    if (isOutputLangStep) { await handleFinalAnalysis(); return; }

    const updatedAnswers = { ...userData.interviewAnswers, [analysisResult.steps[currentStepIndex].category]: currentAnswer };
    setUserData(prev => ({ ...prev, interviewAnswers: updatedAnswers }));

    if (currentStepIndex < analysisResult.steps.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
      setCurrentAnswer('');
    } else {
      setIsOutputLangStep(true);
      setCurrentAnswer('');
    }
  };

  // ─── Final analysis + streaming narrative ──────────────────────────────────
  const handleFinalAnalysis = async () => {
    if (!analysisResult) return;
    setIsAnalyzing(true);
    try {
      const finalResult = await analyzeStructured(
        { intakeText: userData.intakeText, age: userData.age, interviewAnswers: userData.interviewAnswers, seenDoctorBefore: userData.seenDoctorBefore, doctorFindings: userData.doctorFindings },
        uiLanguage, outputLanguage
      );
      setAnalysisResult(finalResult);
      setStreamedNarrative('');
      setScreen('RESULTS');
      setIsAnalyzing(false);

      setIsStreaming(true);
      streamNarrative(
        { intakeText: userData.intakeText, age: userData.age, interviewAnswers: userData.interviewAnswers, seenDoctorBefore: userData.seenDoctorBefore, doctorFindings: userData.doctorFindings },
        outputLanguage,
        chunk => setStreamedNarrative(prev => prev + chunk),
        fullText => {
          setAnalysisResult(prev => prev ? { ...prev, clinicalReport: { ...prev.clinicalReport, narrative: fullText } } : prev);
          setIsStreaming(false);
        },
        err => { console.error(err); setIsStreaming(false); }
      );
    } catch (err) {
      console.error(err);
      setIsAnalyzing(false);
    }
  };

  // ─── PDF + auto-delete ──────────────────────────────────────────────────────
  const handleDownloadPDF = async () => {
    if (!resultsRef.current) return;
    setIsDownloading(true);
    try {
      const original = resultsRef.current;
      const clone = original.cloneNode(true) as HTMLElement;
      clone.style.cssText = `position:absolute;left:-9999px;top:0;width:${original.offsetWidth}px;background:#fff;color:#000;`;
      clone.querySelectorAll<HTMLElement>('*').forEach(el => {
        el.style.color = '#000'; el.style.borderColor = '#000'; el.style.fill = '#000';
        const bg = window.getComputedStyle(el).backgroundColor;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') el.style.backgroundColor = '#fff';
      });
      document.body.appendChild(clone);
      const canvas = await html2canvas(clone, { scale: 2, backgroundColor: '#fff', useCORS: true, logging: false });
      document.body.removeChild(clone);
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [canvas.width / 2, canvas.height / 2] });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdf.internal.pageSize.getWidth(), (canvas.height / canvas.width) * pdf.internal.pageSize.getWidth());
      pdf.save('Clara_Medical_Report.pdf');
      if (autoDelete) {
        setUserData({ intakeText: '', age: '', seenDoctorBefore: false, doctorFindings: '', interviewAnswers: {} });
        setAnalysisResult(null); setStreamedNarrative(''); setDataDeleted(true);
      }
    } catch (err) { console.error(err); }
    finally { setIsDownloading(false); }
  };

  const handleCopyToClipboard = () => {
    if (!analysisResult) return;
    const narrative = isStreaming ? streamedNarrative : analysisResult.clinicalReport.narrative;
    const text = `CLARA CLINICAL REPORT\n\n[GUIDANCE]\nUrgency: ${analysisResult.guidance.urgency}\nTips: ${analysisResult.guidance.tips.join(', ')}\n\n[CLINICAL RECORD]\n${narrative}\n\n` +
      analysisResult.clinicalReport.summaryTable.map(i => `${i.label}: ${i.value}`).join('\n') +
      (currentUser ? `\n\nQuestions for Doctor:\n` + analysisResult.clinicalReport.doctorQuestions.join('\n') : '');
    navigator.clipboard.writeText(text).then(() => { setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); });
  };

  const urgencyStyle: Record<string, string> = {
    Green: 'border-green-500 text-green-700 bg-green-50',
    Yellow: 'border-yellow-500 text-yellow-700 bg-yellow-50',
    Red: 'border-red-500 text-red-700 bg-red-50',
  };

  const totalSteps = (analysisResult?.steps.length ?? 0) + 1;
  const effectiveIndex = isOutputLangStep ? (analysisResult?.steps.length ?? 0) : currentStepIndex;

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-[#FDF6F6] flex flex-col text-[#353D2D]">

      {/* ── NAVBAR ── */}
      <nav className="p-4 flex items-center bg-white/60 backdrop-blur-md border-b border-[#F3F4F6] sticky top-0 z-50">
        <div className="flex items-center gap-2 flex-shrink-0">
          <Heart className="w-5 h-5 text-[#CF7E7E] fill-[#CF7E7E]" />
          <span className="font-bold text-base tracking-tight">CLARA</span>
        </div>

        <div className="flex-1 flex justify-center">
          {currentUser ? (
            <div className="flex items-center gap-2 bg-[#F4F7F2] rounded-full px-3 py-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#7D9168] flex-shrink-0" />
              <span className="text-xs font-bold text-[#617250] max-w-[130px] truncate">{currentUser.displayName || currentUser.email}</span>
              <button onClick={signOutUser} className="text-[#9CAF88] hover:text-[#617250]"><LogOut className="w-3 h-3" /></button>
            </div>
          ) : (
            <button onClick={handleGoogleSignIn} disabled={isSigningIn}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-[#E5E7EB] text-xs font-medium hover:bg-[#FDF6F6] disabled:opacity-50">
              {isSigningIn ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[#CF7E7E]" /> : <LogIn className="w-3.5 h-3.5 text-[#CF7E7E]" />}
              {isSigningIn ? t.auth.signingIn : t.auth.signIn}
            </button>
          )}
        </div>

        <div className="relative flex-shrink-0">
          <button onClick={() => setShowLangDropdown(p => !p)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-[#E5E7EB] text-xs font-medium hover:bg-[#F3F4F6]">
            <Globe className="w-3.5 h-3.5" />{uiLanguage}
          </button>
          <AnimatePresence>
            {showLangDropdown && (
              <motion.div initial={{ opacity: 0, y: -8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.95 }}
                className={cn("absolute top-full mt-2 bg-white border border-[#E5E7EB] rounded-2xl shadow-xl z-50 overflow-hidden min-w-[140px]", isRTL ? "left-0" : "right-0")}>
                {LANGUAGE_OPTIONS.map(l => (
                  <button key={l.code} onClick={() => { setUiLanguage(l.code); setShowLangDropdown(false); }}
                    className={cn("w-full px-4 py-2.5 text-sm text-left flex items-center gap-2 hover:bg-[#F4F7F2]", uiLanguage === l.code && "bg-[#F4F7F2] font-bold text-[#617250]")}>
                    {uiLanguage === l.code && <CheckCircle2 className="w-3 h-3 text-[#7D9168]" />}{l.nativeLabel}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

      {showLangDropdown && <div className="fixed inset-0 z-40" onClick={() => setShowLangDropdown(false)} />}

      {/* ── SCREENS ── */}
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
              <p className="text-[#617250] mb-6 leading-relaxed">{t.disclaimer.text}</p>
              <div className="bg-[#F4F7F2] rounded-2xl p-4 mb-8 text-left space-y-2">
                <PrivacyBadge label={t.privacy.badge} />
                <p className="text-xs text-[#617250] leading-relaxed">{t.privacy.geminiNote}</p>
              </div>
              <button onClick={() => setScreen('WELCOME')}
                className="w-full py-5 bg-[#7D9168] text-white rounded-2xl font-bold hover:bg-[#617250] flex items-center justify-center gap-3 shadow-lg shadow-[#D3DFCC]">
                {t.disclaimer.button}<ArrowRight className={cn("w-5 h-5", isRTL && "rotate-180")} />
              </button>
            </motion.div>
          )}

          {/* WELCOME */}
          {screen === 'WELCOME' && (
            <motion.div key="welcome" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }}
              className="max-w-md w-full text-center">
              <div className="relative w-36 h-36 mx-auto mb-10">
                <div className="absolute inset-0 bg-[#F7DADA] rounded-full blur-3xl opacity-40 animate-pulse" />
                <div className="relative w-full h-full bg-white rounded-full shadow-2xl flex items-center justify-center border-8 border-[#FDF6F6]">
                  <Heart className="w-16 h-16 text-[#CF7E7E]" />
                </div>
              </div>
              <h1 className="text-4xl font-bold mb-4 tracking-tight">{t.welcome.title}</h1>
              <p className="text-lg text-[#617250] mb-5 leading-relaxed">{t.welcome.subtitle}</p>
              <div className="bg-[#F4F7F2] rounded-2xl px-5 py-3 mb-8 text-sm font-medium text-[#617250]">{t.welcome.freeInputHint}</div>
              <button onClick={() => setScreen('INTAKE')}
                className="w-full py-5 bg-[#CF7E7E] text-white rounded-full font-bold text-xl hover:bg-[#B85F5F] shadow-2xl shadow-[#F7DADA]">
                {t.welcome.button}
              </button>
            </motion.div>
          )}

          {/* INTAKE */}
          {screen === 'INTAKE' && (
            <motion.div key="intake" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="max-w-2xl w-full">
              <h1 className="text-3xl font-bold mb-3 text-center">{t.intake.title}</h1>
              <div className="text-center mb-5">
                <span className="inline-block bg-[#F4F7F2] text-[#617250] text-sm font-medium rounded-full px-4 py-1.5">{t.intake.languageHint}</span>
              </div>
              <div className="bg-white rounded-[2.5rem] p-8 shadow-2xl border border-[#F3F4F6]">
                <textarea
                  value={userData.intakeText}
                  onChange={e => setUserData(prev => ({ ...prev, intakeText: e.target.value }))}
                  placeholder={t.intake.placeholder}
                  className="w-full min-h-[250px] bg-transparent border-none focus:ring-0 text-xl placeholder-[#B8CCAA] resize-none"
                />
                <div className="flex justify-between items-center mt-4 flex-wrap gap-3">
                  <button onClick={() => setScreen('WELCOME')}
                    className="px-8 py-4 bg-white border-2 border-[#E9EFE5] rounded-2xl font-bold hover:bg-[#F3F4F6]">{t.analysis.back}</button>
                  <button onClick={() => setScreen('DEMOGRAPHICS')} disabled={!userData.intakeText.trim()}
                    className={cn("px-10 py-4 rounded-2xl font-bold flex items-center gap-3",
                      userData.intakeText.trim() ? "bg-[#353D2D] text-white hover:bg-black" : "bg-[#E9EFE5] text-[#B8CCAA] cursor-not-allowed")}>
                    {t.analysis.next}<ArrowRight className={cn("w-5 h-5", isRTL && "rotate-180")} />
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
                <input type="number" value={userData.age}
                  onChange={e => setUserData(prev => ({ ...prev, age: e.target.value }))}
                  placeholder={t.demographics.ageLabel}
                  className="w-full p-5 bg-[#FDF6F6] rounded-2xl border-2 border-[#F7DADA] text-center text-2xl font-bold focus:ring-2 focus:ring-[#CF7E7E] focus:border-transparent"
                />
                <div className="flex gap-4">
                  <button onClick={() => setScreen('INTAKE')} className="flex-1 py-5 bg-white border-2 border-[#E9EFE5] rounded-2xl font-bold hover:bg-[#F3F4F6]">{t.analysis.back}</button>
                  <button onClick={() => setScreen('MEDICAL_HISTORY')} disabled={!userData.age}
                    className={cn("flex-[2] py-5 rounded-2xl font-bold flex items-center justify-center gap-3 shadow-lg",
                      userData.age ? "bg-[#CF7E7E] text-white hover:bg-[#B85F5F] shadow-[#F7DADA]" : "bg-[#E9EFE5] text-[#B8CCAA] cursor-not-allowed")}>
                    {t.demographics.button}<ArrowRight className={cn("w-5 h-5", isRTL && "rotate-180")} />
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
                {[
                  { val: true, label: t.medical.yes, activeClass: "bg-[#7D9168] border-[#7D9168] text-white" },
                  { val: false, label: t.medical.no, activeClass: "bg-[#CF7E7E] border-[#CF7E7E] text-white" },
                ].map(({ val, label, activeClass }) => (
                  <button key={String(val)}
                    onClick={() => setUserData(prev => ({ ...prev, seenDoctorBefore: val, ...(val ? {} : { doctorFindings: '' }) }))}
                    className={cn("flex-1 py-4 rounded-2xl font-bold border-2 transition-all",
                      userData.seenDoctorBefore === val ? activeClass : "bg-white border-[#E9EFE5] text-[#353D2D] hover:border-[#9CAF88]")}>
                    {label}
                  </button>
                ))}
              </div>
              {userData.seenDoctorBefore && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                  <p className="text-[#617250] mb-3 font-medium text-sm">{t.medical.findingsLabel}</p>
                  <textarea value={userData.doctorFindings}
                    onChange={e => setUserData(prev => ({ ...prev, doctorFindings: e.target.value }))}
                    placeholder={t.medical.findingsPlaceholder}
                    className="w-full min-h-[120px] p-4 bg-[#F4F7F2] rounded-2xl border-none focus:ring-2 focus:ring-[#9CAF88] text-base resize-none" />
                </motion.div>
              )}
              <div className="flex gap-4">
                <button onClick={() => setScreen('DEMOGRAPHICS')} className="flex-1 py-5 bg-white border-2 border-[#E9EFE5] rounded-2xl font-bold hover:bg-[#F3F4F6]">{t.analysis.back}</button>
                <button onClick={handleIntakeSubmit}
                  className="flex-[2] py-5 bg-[#CF7E7E] text-white rounded-2xl font-bold hover:bg-[#B85F5F] flex items-center justify-center gap-3 shadow-lg shadow-[#F7DADA]">
                  {t.medical.button}<ArrowRight className={cn("w-5 h-5", isRTL && "rotate-180")} />
                </button>
              </div>
            </motion.div>
          )}

          {/* ANALYSIS */}
          {screen === 'ANALYSIS' && (
            <motion.div key="analysis" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl w-full space-y-6">

              {/* ── Fake progress bar — always visible during loading ── */}
              <div className="w-full bg-[#E9EFE5] h-2 rounded-full overflow-hidden">
                <motion.div
                  animate={{ width: isAnalyzing ? `${fakeProgress}%` : `${((effectiveIndex + 1) / totalSteps) * 100}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  className="h-full bg-[#7D9168]"
                />
              </div>

              {isAnalyzing ? (
                /* ── SKELETON STATE ── */
                <div className="space-y-5">
                  {/* Rotating message */}
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={rotatingMsg}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.35 }}
                      className="flex items-center justify-center gap-2 text-sm font-semibold text-[#617250]"
                    >
                      <Shield className="w-4 h-4 text-[#7D9168] flex-shrink-0" />
                      {rotatingMsg}
                    </motion.div>
                  </AnimatePresence>

                  <SkeletonQuestionCard />
                </div>
              ) : analysisResult && (
                /* ── REAL CONTENT ── */
                isOutputLangStep ? (
                  <div className="bg-white rounded-[2.5rem] p-10 shadow-2xl border border-[#F3F4F6]">
                    <div className="flex items-center gap-3 mb-4 text-[#9CAF88] font-bold uppercase tracking-widest text-sm">
                      <Globe className="w-5 h-5" />
                    </div>
                    <h2 className="text-2xl font-bold mb-3 leading-tight">{t.analysis.outputLangQuestion}</h2>
                    <p className="text-sm text-[#9CAF88] mb-8">{t.analysis.outputLangHint}</p>
                    <div className="space-y-3 mb-8">
                      {OUTPUT_LANGUAGE_OPTIONS.map(lang => (
                        <button key={lang.code} onClick={() => setOutputLanguage(lang.code)}
                          className={cn("w-full p-4 rounded-2xl border-2 text-left transition-all",
                            outputLanguage === lang.code ? "bg-[#F4F7F2] border-[#7D9168]" : "bg-white border-[#E9EFE5] hover:border-[#9CAF88]")}>
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-lg">{lang.label}</span>
                            {outputLanguage === lang.code && <CheckCircle2 className="w-5 h-5 text-[#7D9168]" />}
                          </div>
                          <p className="text-xs mt-1 text-[#9CAF88]">{lang.description}</p>
                        </button>
                      ))}
                    </div>
                    <div className="flex justify-between">
                      <button onClick={handleBack} className="px-8 py-4 bg-white border-2 border-[#E9EFE5] rounded-2xl font-bold hover:bg-[#F3F4F6]">{t.analysis.back}</button>
                      <button onClick={handleNextStep}
                        className="px-12 py-5 bg-[#CF7E7E] text-white rounded-2xl font-bold hover:bg-[#B85F5F] flex items-center gap-3 shadow-lg shadow-[#F7DADA]">
                        {t.analysis.finish}<ArrowRight className={cn("w-5 h-5", isRTL && "rotate-180")} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-[2.5rem] p-10 shadow-2xl border border-[#F3F4F6]">
                    <div className="flex items-center gap-3 mb-6 text-[#9CAF88] font-bold uppercase tracking-widest text-sm">
                      <Sparkles className="w-5 h-5" />{analysisResult.steps[currentStepIndex].category}
                    </div>
                    <h2 className="text-3xl font-bold mb-10 leading-tight">{analysisResult.steps[currentStepIndex].question}</h2>

                    {currentStepIndex === analysisResult.steps.length - 1 ? (
                      <textarea value={currentAnswer} onChange={e => setCurrentAnswer(e.target.value)}
                        placeholder={t.analysis.precisionPlaceholder}
                        className="w-full min-h-[200px] p-6 bg-[#F4F7F2] rounded-3xl border-none focus:ring-2 focus:ring-[#9CAF88] text-lg" />
                    ) : (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                          {analysisResult.steps[currentStepIndex].suggestions.map((s, i) => (
                            <button key={i} onClick={() => setCurrentAnswer(s)}
                              className={cn("p-5 rounded-2xl border-2 text-left font-medium transition-all",
                                currentAnswer === s ? "bg-[#7D9168] border-[#7D9168] text-white" : "bg-white border-[#E9EFE5] text-[#4C593F] hover:border-[#9CAF88]")}>
                              {s}
                            </button>
                          ))}
                        </div>
                        <input type="text" value={currentAnswer} onChange={e => setCurrentAnswer(e.target.value)}
                          placeholder={t.analysis.precisionPlaceholder}
                          className="w-full p-6 bg-[#F4F7F2] rounded-2xl border-none focus:ring-2 focus:ring-[#9CAF88] text-lg" />
                      </div>
                    )}

                    <div className="flex justify-between items-center mt-10">
                      <button onClick={handleBack} className="px-8 py-4 bg-white border-2 border-[#E9EFE5] rounded-2xl font-bold hover:bg-[#F3F4F6]">{t.analysis.back}</button>
                      <button onClick={handleNextStep} disabled={!currentAnswer.trim()}
                        className={cn("px-12 py-5 rounded-2xl font-bold flex items-center gap-3",
                          currentAnswer.trim() ? "bg-[#353D2D] text-white hover:bg-black" : "bg-[#E9EFE5] text-[#B8CCAA] cursor-not-allowed")}>
                        {t.analysis.next}<ArrowRight className={cn("w-5 h-5", isRTL && "rotate-180")} />
                      </button>
                    </div>
                  </div>
                )
              )}
            </motion.div>
          )}

          {/* RESULTS */}
          {screen === 'RESULTS' && analysisResult && (
            <motion.div key="results" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl w-full space-y-8">

              {dataDeleted && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="bg-[#F4F7F2] border border-[#9CAF88] rounded-2xl p-4 text-center text-sm font-bold text-[#617250]">
                  {t.results.autoDeleteConfirm}
                </motion.div>
              )}

              <div ref={resultsRef} className="bg-white p-10 border-[3px] border-black text-black font-sans leading-relaxed">
                {/* Header */}
                <div className="border-b-[3px] border-black pb-6 mb-8 flex justify-between items-end">
                  <div>
                    <h1 className="text-3xl font-black uppercase tracking-tighter mb-1">{t.results.title}</h1>
                    <p className="text-xs font-bold uppercase tracking-[0.2em]">{t.results.footer}</p>
                  </div>
                  <div className="text-right space-y-1">
                    <p className="text-xs font-bold">{new Date().toLocaleDateString()}</p>
                    <PrivacyBadge label={t.privacy.badgeShort} />
                  </div>
                </div>

                {/* Guidance */}
                <div className="mb-10">
                  <h2 className="text-xl font-black uppercase border-b-2 border-black mb-4 pb-1">
                    {uiLanguage === 'AR' ? 'التوجيه والاحتمالات الطبية' : 'Guidance & Possibilities'}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <p className="text-[10px] font-black uppercase mb-2">Urgency Level</p>
                      <div className={cn("inline-block border-2 px-4 py-2 font-black uppercase text-sm mb-4", urgencyStyle[analysisResult.guidance.urgency] || 'border-black')}>
                        {analysisResult.guidance.urgency}
                      </div>
                      <p className="text-[10px] font-black uppercase mb-2">Clinical Tips</p>
                      <ul className="space-y-2">{analysisResult.guidance.tips.map((tip, i) => <li key={i} className="text-sm font-bold flex gap-2"><span>•</span>{tip}</li>)}</ul>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase mb-2">Potential Conditions</p>
                      <div className="space-y-3">
                        {analysisResult.guidance.potentialConditions.map((c, i) => (
                          <div key={i} className="border border-black p-3">
                            <p className="font-black text-sm uppercase">{c.name}</p>
                            <p className="text-xs font-medium leading-tight">{c.explanation}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Narrative — streaming */}
                <div className="mb-10">
                  <h2 className="text-xl font-black uppercase border-b-2 border-black mb-4 pb-1">
                    {uiLanguage === 'AR' ? 'السجل السريري المفصل' : 'Detailed Clinical Record'}
                  </h2>
                  <div className="border-2 border-black p-6 text-lg font-bold leading-relaxed bg-[#F9FAF9] min-h-[100px]">
                    {isStreaming ? (
                      <>
                        <p className="text-xs font-bold text-[#9CAF88] mb-3 uppercase tracking-widest flex items-center gap-2">
                          <Shield className="w-3.5 h-3.5" />{t.privacy.streamingNote}
                        </p>
                        {streamedNarrative}<StreamCursor />
                      </>
                    ) : (analysisResult.clinicalReport.narrative || streamedNarrative)}
                  </div>
                </div>

                {/* Summary Table */}
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

                {/* Doctor Questions */}
                <div>
                  <h2 className="text-xl font-black uppercase border-b-2 border-black mb-4 pb-1">{t.results.doctorQuestions}</h2>
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
                      <Lock className="w-7 h-7 text-[#CF7E7E] mx-auto mb-2" />
                      <p className="font-bold text-[#353D2D] text-sm">{t.results.doctorQuestionsLocked}</p>
                    </div>
                  )}
                </div>

                <div className="mt-12 pt-6 border-t-[3px] border-black flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-[0.5em]">{t.results.footer}</p>
                  <PrivacyBadge label={t.privacy.badgeShort} />
                </div>
              </div>

              {!currentUser && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className="bg-[#FDF6F6] border-2 border-[#CF7E7E] rounded-2xl p-6 flex flex-col gap-4 text-center">
                  <p className="font-bold text-[#353D2D]">🔒 {t.auth.unlockPrompt}</p>
                  <button onClick={handleGoogleSignIn} disabled={isSigningIn}
                    className="flex items-center justify-center gap-3 bg-white border-2 border-[#CF7E7E] py-4 rounded-2xl font-black hover:bg-[#FDF6F6] disabled:opacity-50">
                    {isSigningIn ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5 text-[#CF7E7E]" />}
                    {t.auth.signIn}
                  </button>
                </motion.div>
              )}

              <div className="space-y-4">
                <div className="bg-[#F4F7F2] rounded-2xl p-4">
                  <PrivacyBadge label={t.privacy.badge} />
                  <p className="text-xs text-[#617250] mt-1.5 leading-relaxed">{t.privacy.geminiNote}</p>
                </div>
                <div className="bg-white rounded-2xl p-4 border-2 border-black flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-black flex-shrink-0" />
                  <p className="text-sm font-bold text-black">{t.results.captureInstruction}</p>
                </div>
                <div onClick={() => setAutoDelete(p => !p)}
                  className={cn("flex items-center gap-3 p-4 rounded-2xl border-2 cursor-pointer transition-all",
                    autoDelete ? "border-[#CF7E7E] bg-[#FDF6F6]" : "border-[#E9EFE5] bg-white")}>
                  <div className={cn("w-5 h-5 rounded flex items-center justify-center border-2 flex-shrink-0",
                    autoDelete ? "border-[#CF7E7E] bg-[#CF7E7E]" : "border-[#E9EFE5]")}>
                    {autoDelete && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                  </div>
                  <Trash2 className="w-4 h-4 text-[#CF7E7E] flex-shrink-0" />
                  <p className="text-sm font-bold text-[#353D2D]">{t.results.autoDeleteLabel}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button onClick={handleCopyToClipboard} disabled={isStreaming}
                    className="flex items-center justify-center gap-3 bg-white border-2 border-black py-5 rounded-2xl font-black uppercase hover:bg-gray-100 disabled:opacity-50">
                    {isCopied ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5" />}
                    {isCopied ? t.results.copied : t.results.copy}
                  </button>
                  <button onClick={handleDownloadPDF} disabled={isDownloading || isStreaming}
                    className="flex items-center justify-center gap-3 bg-black text-white py-5 rounded-2xl font-black uppercase hover:bg-gray-900 disabled:opacity-50">
                    {isDownloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
                    {t.results.downloadPDF}
                  </button>
                </div>
                <button onClick={() => { setScreen('WELCOME'); setAnalysisResult(null); setStreamedNarrative(''); setDataDeleted(false); setUserData({ intakeText: '', age: '', seenDoctorBefore: false, doctorFindings: '', interviewAnswers: {} }); }}
                  className="w-full py-5 bg-gray-200 rounded-2xl font-black uppercase hover:bg-gray-300 flex items-center justify-center gap-3">
                  <RefreshCw className="w-5 h-5" />{t.results.new}
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>
    </div>
  );
}
