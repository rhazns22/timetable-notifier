/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc,
  setDoc,
  where,
  serverTimestamp,
  getDocs
} from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';
import { 
  Teacher, 
  Schedule, 
  ScheduleItem, 
  DisplaySettings, 
  ActivityType, 
  OperationType, 
  FirestoreErrorInfo 
} from './types';
import { cn } from './lib/utils';
import { 
  Clock, 
  Plus, 
  Trash2, 
  LogOut, 
  BookOpen, 
  Coffee, 
  Utensils, 
  Sun, 
  Moon, 
  Play,
  Volume2,
  Edit2,
  Settings,
  Calendar,
  Copy,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  Monitor,
  Check,
  Menu,
  X,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, parse, isWithinInterval, differenceInSeconds, addDays, subDays } from 'date-fns';

// --- Error Handling ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Constants ---
const ACTIVITY_ICONS: Record<ActivityType, any> = {
  morning: Sun,
  class: BookOpen,
  lunch: Utensils,
  break: Coffee,
  afterschool: Moon,
};

const ACTIVITY_COLORS: Record<ActivityType, string> = {
  morning: 'bg-amber-100 text-amber-700 border-amber-200',
  class: 'bg-blue-100 text-blue-700 border-blue-200',
  lunch: 'bg-green-100 text-green-700 border-green-200',
  break: 'bg-purple-100 text-purple-700 border-purple-200',
  afterschool: 'bg-slate-100 text-slate-700 border-slate-200',
};

// --- Components ---

function DebouncedInput({ 
  value, 
  onChange, 
  className, 
  placeholder 
}: { 
  value: string; 
  onChange: (val: string) => void; 
  className?: string;
  placeholder?: string;
}) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleBlur = () => {
    if (localValue !== value) {
      onChange(localValue);
    }
  };

  return (
    <input
      className={className}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder={placeholder}
    />
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState<'landing' | 'teacher' | 'student'>('landing');
  const [teacherId, setTeacherId] = useState<string | null>(null);
  
  // Teacher State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [activeSchedule, setActiveSchedule] = useState<Schedule | null>(null);
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>({
    showCountdown: true,
    showNextActivity: true,
    fullscreenMode: true,
    theme: 'light',
    voiceRate: 1.0
  });

  // Student State
  const [currentTime, setCurrentTime] = useState(new Date());
  const [lastAnnouncedId, setLastAnnouncedId] = useState<string | null>(null);
  const [lastOneMinId, setLastOneMinId] = useState<string | null>(null);
  const [showFullScreen, setShowFullScreen] = useState(false);
  const [showList, setShowList] = useState(false);
  const [showTeacherIdModal, setShowTeacherIdModal] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [inputTeacherId, setInputTeacherId] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // --- Toast Timer ---
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // --- Auth & Initial Load ---
  useEffect(() => {
    // Test Firestore connection
    const testConnection = async () => {
      try {
        const { getDocFromServer } = await import('firebase/firestore');
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error: any) {
        if (error.message?.includes('the client is offline')) {
          console.error("Firebase configuration might be incorrect or API is blocked.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
      
      // Handle student view via URL
      const params = new URLSearchParams(window.location.search);
      const tid = params.get('teacherId');
      if (tid) {
        setTeacherId(tid);
        setView('student');
      } else if (user) {
        setView('teacher');
      }
    });
    return unsubscribe;
  }, []);

  // --- Teacher: Load Schedule for Date ---
  useEffect(() => {
    if (view === 'teacher' && user) {
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      const q = query(
        collection(db, 'schedules'), 
        where('teacherId', '==', user.uid),
        where('date', '==', dateStr)
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
          const schedule = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Schedule;
          setActiveSchedule(schedule);
        } else {
          setActiveSchedule(null);
          setScheduleItems([]);
        }
      });
      return unsubscribe;
    }
  }, [view, user, currentDate]);

  // --- Teacher: Load Items for Schedule ---
  useEffect(() => {
    if (activeSchedule) {
      const q = query(collection(db, `schedules/${activeSchedule.id}/items`), orderBy('order', 'asc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ScheduleItem[];
        setScheduleItems(items);
      });
      return unsubscribe;
    }
  }, [activeSchedule]);

  // --- Student: Load Data for Teacher ---
  useEffect(() => {
    if (view === 'student' && teacherId) {
      const dateStr = format(currentTime, 'yyyy-MM-dd');
      const q = query(
        collection(db, 'schedules'), 
        where('teacherId', '==', teacherId),
        where('date', '==', dateStr)
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
          const schedule = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Schedule;
          setActiveSchedule(schedule);
        }
      });
      return unsubscribe;
    }
  }, [view, teacherId, currentTime]);

  // --- Settings Listener ---
  useEffect(() => {
    const tid = view === 'teacher' ? user?.uid : teacherId;
    if (tid) {
      const unsubscribe = onSnapshot(doc(db, 'display_settings', tid), (doc) => {
        if (doc.exists()) {
          setDisplaySettings(doc.data() as DisplaySettings);
        }
      });
      return unsubscribe;
    }
  }, [view, user, teacherId]);

  // --- Clock ---
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // --- TTS ---
  const speak = useCallback((text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ko-KR';
      utterance.rate = displaySettings.voiceRate;
      window.speechSynthesis.speak(utterance);
    }
  }, [displaySettings.voiceRate]);

  // --- Logic: Current & Next ---
  const { currentActivity, nextActivity } = useMemo(() => {
    const today = format(currentTime, 'yyyy-MM-dd');
    let current: ScheduleItem | null = null;
    let next: ScheduleItem | null = null;

    for (let i = 0; i < scheduleItems.length; i++) {
      const item = scheduleItems[i];
      const start = parse(`${today} ${item.startTime}`, 'yyyy-MM-dd HH:mm', new Date());
      const end = parse(`${today} ${item.endTime}`, 'yyyy-MM-dd HH:mm', new Date());

      if (isWithinInterval(currentTime, { start, end })) {
        current = item;
        next = scheduleItems[i + 1] || null;
        break;
      }
      if (currentTime < start) {
        next = item;
        break;
      }
    }
    return { currentActivity: current, nextActivity: next };
  }, [scheduleItems, currentTime]);

  // --- Auto Announcement & 1-Min Warning ---
  useEffect(() => {
    if (view === 'student') {
      // Start Announcement
      if (currentActivity && currentActivity.id !== lastAnnouncedId) {
        setLastAnnouncedId(currentActivity.id);
        if (displaySettings.fullscreenMode) setShowFullScreen(true);
        if (currentActivity.useVoice) {
          speak(currentActivity.voiceText || `${currentActivity.activityName} 시간이 시작되었습니다.`);
        }
        const timer = setTimeout(() => setShowFullScreen(false), 10000);
        return () => clearTimeout(timer);
      }

      // 1-Minute Warning
      if (nextActivity && nextActivity.id !== lastOneMinId) {
        const today = format(currentTime, 'yyyy-MM-dd');
        const start = parse(`${today} ${nextActivity.startTime}`, 'yyyy-MM-dd HH:mm', new Date());
        const diff = differenceInSeconds(start, currentTime);
        
        if (diff > 55 && diff <= 60) {
          setLastOneMinId(nextActivity.id);
          speak(`1분 후 ${nextActivity.activityName} 시간이 시작됩니다. 준비해 주세요.`);
        }
      }
    }
  }, [view, currentActivity, nextActivity, lastAnnouncedId, lastOneMinId, displaySettings, speak, currentTime]);

  // --- Handlers ---
  const copyToClipboard = async (text: string, successMessage: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setToastMessage(successMessage);
      } else {
        // Fallback for non-secure contexts or sandboxed iframes
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          setToastMessage(successMessage);
        } catch (err) {
          console.error('Fallback copy failed', err);
        }
        document.body.removeChild(textArea);
      }
    } catch (err) {
      console.error('Copy failed', err);
    }
  };

  const handleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const teacherDoc = doc(db, 'teachers', result.user.uid);
      await setDoc(teacherDoc, {
        name: result.user.displayName,
        email: result.user.email,
        createdAt: serverTimestamp()
      }, { merge: true });
      setView('teacher');
    } catch (error: any) {
      console.error('Login failed', error);
      if (error.code === 'auth/popup-closed-by-user') {
        setToastMessage('로그인 창이 닫혔습니다. 다시 시도해 주세요.');
      } else if (error.code === 'auth/cancelled-popup-request') {
        // Ignore multiple popup requests
      } else if (error.message.includes('requests-to-this-api-identitytoolkit')) {
        setToastMessage('인증 서비스 설정 중입니다. 잠시 후 다시 시도해 주세요.');
      } else {
        setToastMessage('로그인에 실패했습니다. 관리자에게 문의하세요.');
      }
    }
  };

  const createSchedule = async () => {
    if (!user) return;
    const dateStr = format(currentDate, 'yyyy-MM-dd');
    const scheduleData: Partial<Schedule> = {
      teacherId: user.uid,
      date: dateStr,
      title: `${dateStr} 시간표`,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    const docRef = await addDoc(collection(db, 'schedules'), scheduleData);
    setActiveSchedule({ id: docRef.id, ...scheduleData } as Schedule);
  };

  const addScheduleItem = async () => {
    if (!activeSchedule) return;
    const path = `schedules/${activeSchedule.id}/items`;
    await addDoc(collection(db, path), {
      order: scheduleItems.length,
      activityName: '새 활동',
      startTime: '09:00',
      endTime: '09:40',
      activityType: 'class',
      useVoice: true,
      voiceText: '',
      color: '#3b82f6'
    });
  };

  const updateScheduleItem = async (id: string, data: Partial<ScheduleItem>) => {
    if (!activeSchedule) return;
    await updateDoc(doc(db, `schedules/${activeSchedule.id}/items`, id), data);
  };

  const deleteScheduleItem = async (id: string) => {
    if (!activeSchedule) return;
    await deleteDoc(doc(db, `schedules/${activeSchedule.id}/items`, id));
  };

  const updateSettings = async (data: Partial<DisplaySettings>) => {
    if (!user) return;
    await setDoc(doc(db, 'display_settings', user.uid), data, { merge: true });
  };

  const extractTeacherId = (input: string) => {
    try {
      const url = new URL(input);
      return url.searchParams.get('teacherId') || input;
    } catch {
      return input;
    }
  };

  const handleTeacherIdSubmit = () => {
    const input = inputTeacherId.trim();
    if (!input) return;

    try {
      // If it's a full URL, just go there
      if (input.startsWith('http')) {
        window.location.href = input;
        return;
      }
      
      // Otherwise extract ID and set search param
      const id = extractTeacherId(input);
      window.location.search = `?teacherId=${id}`;
    } catch {
      window.location.search = `?teacherId=${input}`;
    }
  };

  // --- Render Helpers ---
  if (!isAuthReady) return <div className="min-h-screen flex items-center justify-center bg-white"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-blue-600"></div></div>;

  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl">
          <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-xl shadow-blue-100">
            <Clock className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl sm:text-5xl font-black text-slate-900 mb-6 tracking-tight">스마트 시간표 알림이</h1>
          <p className="text-base sm:text-xl text-slate-500 mb-12 leading-relaxed">선생님은 시간표를 관리하고, 학생들은 대형 화면으로 수업 흐름을 확인합니다. 실시간 동기화와 음성 안내로 수업 효율을 높이세요.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center w-full max-w-md mx-auto">
            <button onClick={handleLogin} className="w-full sm:w-auto px-8 py-4 bg-blue-600 text-white rounded-2xl font-bold text-base lg:text-lg shadow-lg hover:bg-blue-700 transition-all flex items-center justify-center gap-2">
              <UserIcon className="w-5 h-5" /> 선생님으로 시작하기
            </button>
            <button onClick={() => setShowTeacherIdModal(true)} className="w-full sm:w-auto px-8 py-4 bg-slate-100 text-slate-700 rounded-2xl font-bold text-base lg:text-lg hover:bg-slate-200 transition-all flex items-center justify-center gap-2">
              <Monitor className="w-5 h-5" /> 학생용 화면 보기
            </button>
          </div>
        </motion.div>

        {/* Teacher ID Modal */}
        <AnimatePresence>
          {showTeacherIdModal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-[32px] p-8 max-w-md w-full shadow-2xl"
              >
                <h3 className="text-2xl font-black text-slate-900 mb-2">선생님 ID 입력</h3>
                <p className="text-slate-500 mb-6 text-sm">공유받은 선생님의 고유 ID 또는 <b>전체 링크</b>를 그대로 붙여넣으셔도 됩니다.</p>
                <input 
                  autoFocus
                  className="w-full p-4 bg-slate-100 rounded-2xl border-2 border-transparent focus:border-blue-500 focus:outline-none font-bold text-base lg:text-lg mb-6"
                  placeholder="ID 또는 전체 링크를 입력하세요"
                  value={inputTeacherId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setInputTeacherId(val);
                    // If a full URL is pasted, we can try to handle it immediately or wait for Enter
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleTeacherIdSubmit();
                    }
                  }}
                />
                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowTeacherIdModal(false)}
                    className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-all"
                  >
                    취소
                  </button>
                  <button 
                    onClick={handleTeacherIdSubmit}
                    className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                  >
                    확인
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  if (view === 'teacher') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row overflow-hidden font-sans">
        {/* Mobile Header */}
        <div className="lg:hidden bg-white border-b border-slate-200 p-4 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center"><Clock className="w-5 h-5 text-white" /></div>
            <h1 className="font-black text-lg text-slate-900">교사 대시보드</h1>
          </div>
          <button 
            onClick={() => setShowMobileSidebar(!showMobileSidebar)}
            className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
          >
            {showMobileSidebar ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Sidebar */}
        <aside className={cn(
          "fixed inset-y-0 left-0 z-50 w-80 bg-white border-r border-slate-200 flex flex-col transition-transform duration-300 lg:relative lg:translate-x-0",
          showMobileSidebar ? "translate-x-0" : "-translate-x-full"
        )}>
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => setView('landing')} className="p-2 -ml-2 text-slate-400 hover:text-blue-600 transition-colors" title="홈으로">
                <ChevronLeft className="w-6 h-6" />
              </button>
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center"><Clock className="w-5 h-5 text-white" /></div>
              <h1 className="font-black text-lg text-slate-900">교사 대시보드</h1>
            </div>
            <button onClick={() => signOut(auth)} className="p-2 text-slate-400 hover:text-red-500" title="로그아웃"><LogOut className="w-5 h-5" /></button>
          </div>

          <div className="p-6 space-y-8 overflow-y-auto flex-1">
            {/* Date Selector */}
            <div className="space-y-3">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest">날짜 선택</label>
              <div className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-100">
                <button onClick={() => setCurrentDate(subDays(currentDate, 1))} className="p-2 hover:bg-white rounded-lg transition-all"><ChevronLeft className="w-4 h-4" /></button>
                <span className="font-bold text-slate-700">{format(currentDate, 'MM월 dd일 (E)')}</span>
                <button onClick={() => setCurrentDate(addDays(currentDate, 1))} className="p-2 hover:bg-white rounded-lg transition-all"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>

            {/* Display Settings */}
            <div className="space-y-4">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest">표시 설정</label>
              <div className="space-y-3">
                {[
                  { key: 'showCountdown', label: '카운트다운 표시' },
                  { key: 'showNextActivity', label: '다음 활동 예고' },
                  { key: 'fullscreenMode', label: '전체화면 자동 전환' }
                ].map(opt => (
                  <label key={opt.key} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-all">
                    <span className="text-sm font-bold text-slate-600">{opt.label}</span>
                    <input 
                      type="checkbox" 
                      checked={(displaySettings as any)[opt.key]} 
                      onChange={(e) => updateSettings({ [opt.key]: e.target.checked })}
                      className="w-5 h-5 rounded-md border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Share Link */}
            <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
              <p className="text-xs font-bold text-blue-600 mb-2">학생용 공유 링크</p>
              <button 
                onClick={() => {
                  const url = `${window.location.origin}${window.location.pathname}?teacherId=${user?.uid}`;
                  copyToClipboard(url, '링크가 복사되었습니다!');
                }}
                className="w-full py-2 bg-white text-blue-600 rounded-lg text-xs font-bold flex items-center justify-center gap-2 shadow-sm"
              >
                <ExternalLink className="w-3 h-3" /> 링크 복사하기
              </button>
            </div>
          </div>
        </aside>

        {/* Mobile Sidebar Overlay */}
        <AnimatePresence>
          {showMobileSidebar && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMobileSidebar(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
            />
          )}
        </AnimatePresence>

        {/* Main Content */}
        <main className="flex-1 flex flex-col h-screen overflow-hidden">
          <header className="p-4 lg:p-6 bg-white border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <h2 className="text-xl lg:text-2xl font-black text-slate-900">{format(currentDate, 'yyyy년 MM월 dd일')} 시간표</h2>
            <div className="flex flex-wrap items-center justify-center gap-2 w-full sm:w-auto">
              <button 
                onClick={() => {
                  const url = `${window.location.origin}${window.location.pathname}?teacherId=${user?.uid}`;
                  copyToClipboard(url, '학생용 링크가 복사되었습니다!');
                }}
                className="flex-1 sm:flex-none px-3 lg:px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs lg:text-sm flex items-center justify-center gap-2 hover:bg-slate-200"
              >
                <Copy className="w-4 h-4" /> 링크 복사
              </button>
              <button 
                onClick={() => {
                  setTeacherId(user?.uid || null);
                  setView('student');
                }}
                className="flex-1 sm:flex-none px-3 lg:px-4 py-2 bg-slate-900 text-white rounded-xl font-bold text-xs lg:text-sm flex items-center justify-center gap-2 hover:bg-black transition-all"
              >
                <Monitor className="w-4 h-4" /> 학생 화면
              </button>
              <button onClick={addScheduleItem} className="flex-1 sm:flex-none px-3 lg:px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-xs lg:text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-100 hover:bg-blue-700">
                <Plus className="w-4 h-4" /> 활동 추가
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-4 bg-slate-50">
            {!activeSchedule ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 bg-slate-200 rounded-3xl flex items-center justify-center mb-6"><Calendar className="w-10 h-10 text-slate-400" /></div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">오늘 등록된 시간표가 없습니다</h3>
                <p className="text-slate-500 mb-8">수업을 시작하려면 새로운 시간표를 생성하세요.</p>
                <button onClick={createSchedule} className="px-8 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-xl hover:bg-blue-700 transition-all">새 시간표 만들기</button>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto space-y-4">
                <AnimatePresence mode="popLayout">
                  {scheduleItems.map((item) => (
                    <motion.div key={item.id} layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="bg-white p-4 lg:p-6 rounded-3xl border border-slate-100 shadow-sm group">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4 lg:gap-6">
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className={cn("w-10 h-10 lg:w-12 lg:h-12 rounded-xl lg:rounded-2xl flex items-center justify-center border shrink-0", ACTIVITY_COLORS[item.activityType])}>
                            {(() => { const Icon = ACTIVITY_ICONS[item.activityType]; return <Icon className="w-5 h-5 lg:w-6 lg:h-6" />; })()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <DebouncedInput 
                              className="w-full text-base lg:text-lg font-black text-slate-800 focus:outline-none focus:border-b-2 border-blue-500 bg-transparent truncate"
                              value={item.activityName}
                              onChange={(val) => updateScheduleItem(item.id, { activityName: val })}
                            />
                            <div className="flex items-center gap-2 mt-1">
                              <input type="time" className="text-xs lg:text-sm font-bold text-slate-400 bg-transparent" value={item.startTime} onChange={(e) => updateScheduleItem(item.id, { startTime: e.target.value })} />
                              <span className="text-slate-300">-</span>
                              <input type="time" className="text-xs lg:text-sm font-bold text-slate-400 bg-transparent" value={item.endTime} onChange={(e) => updateScheduleItem(item.id, { endTime: e.target.value })} />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-2 border-t sm:border-none pt-3 sm:pt-0">
                          <select 
                            className="bg-slate-50 border-none rounded-xl text-[10px] lg:text-sm font-bold text-slate-600 p-2"
                            value={item.activityType}
                            onChange={(e) => updateScheduleItem(item.id, { activityType: e.target.value as ActivityType })}
                          >
                            <option value="morning">아침활동</option>
                            <option value="class">수업</option>
                            <option value="lunch">점심시간</option>
                            <option value="break">쉬는시간</option>
                            <option value="afterschool">방과후</option>
                          </select>
                          
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={() => updateScheduleItem(item.id, { useVoice: !item.useVoice })}
                              className={cn("p-2 lg:p-3 rounded-xl transition-all", item.useVoice ? "bg-blue-50 text-blue-600" : "bg-slate-50 text-slate-300")}
                            >
                              <Volume2 className="w-4 h-4 lg:w-5 lg:h-5" />
                            </button>
                            <button 
                              onClick={() => deleteScheduleItem(item.id)}
                              className="p-2 lg:p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                            >
                              <Trash2 className="w-4 h-4 lg:w-5 lg:h-5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </main>

        {/* Toast Notification */}
        <AnimatePresence>
          {toastMessage && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-slate-900 text-white px-6 py-3 rounded-2xl font-bold shadow-2xl flex items-center gap-3"
            >
              <Check className="w-5 h-5 text-green-400" />
              {toastMessage}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  if (view === 'student') {
    return (
      <div className="min-h-screen bg-white flex flex-col font-sans overflow-hidden">
        {/* Student View: Minimal, High Contrast, Large Fonts */}
        <main className="flex-1 flex flex-col p-8 lg:p-16 relative">
          {/* Top Bar */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 lg:mb-16 gap-6">
            <div className="flex items-center gap-4 lg:gap-6">
              <div className="w-12 h-12 lg:w-16 lg:h-16 bg-blue-600 rounded-2xl lg:rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-200 shrink-0">
                <Clock className="w-6 h-6 lg:w-8 lg:h-8 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-4xl lg:text-6xl font-black text-slate-900 tracking-tighter truncate">{format(currentTime, 'HH:mm:ss')}</h1>
                <p className="text-slate-400 font-black uppercase tracking-widest text-[10px] lg:text-sm mt-1 truncate">{format(currentTime, 'yyyy.MM.dd EEEE')}</p>
              </div>
            </div>
            <div className="flex flex-row items-center gap-2 lg:gap-4 w-full md:w-auto">
              <button 
                onClick={() => setShowList(!showList)}
                className="flex-1 md:flex-none bg-white px-4 lg:px-8 py-2 lg:py-4 rounded-2xl lg:rounded-3xl border border-slate-200 shadow-sm font-black text-slate-700 uppercase tracking-widest text-[10px] lg:text-xs hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
              >
                <Calendar className="w-3 h-3 lg:w-4 lg:h-4" /> {showList ? '현재 활동' : '전체 시간표'}
              </button>
              <div className="flex-1 md:flex-none bg-slate-50 px-4 lg:px-8 py-2 lg:py-4 rounded-2xl lg:rounded-3xl border border-slate-100 flex items-center justify-center gap-2 lg:gap-4">
                <div className="w-2 h-2 lg:w-3 lg:h-3 bg-green-500 rounded-full animate-pulse shrink-0" />
                <span className="font-black text-slate-700 uppercase tracking-widest text-[10px] lg:text-xs truncate">실시간</span>
              </div>
            </div>
          </div>

          {/* Current Activity or List View */}
          <div className="flex-1 flex flex-col justify-center items-center text-center max-w-6xl mx-auto w-full">
            <AnimatePresence mode="wait">
              {showList ? (
                <motion.div 
                  key="list-view"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="w-full max-w-4xl space-y-4"
                >
                  <h2 className="text-2xl lg:text-4xl font-black text-slate-900 mb-4 lg:mb-8">오늘의 전체 시간표</h2>
                  <div className="space-y-3 lg:space-y-4">
                    {scheduleItems.map((item) => (
                      <div 
                        key={item.id}
                        className={cn(
                          "p-4 lg:p-8 rounded-2xl lg:rounded-[32px] border-2 lg:border-4 flex flex-col sm:flex-row items-start sm:items-center justify-between transition-all gap-4",
                          currentActivity?.id === item.id 
                            ? "bg-blue-600 border-blue-400 text-white shadow-2xl scale-[1.02] lg:scale-105 z-10" 
                            : "bg-white border-slate-100 text-slate-800"
                        )}
                      >
                        <div className="flex items-center gap-4 lg:gap-8">
                          <div className={cn(
                            "w-12 h-12 lg:w-16 lg:h-16 rounded-xl lg:rounded-2xl flex items-center justify-center",
                            currentActivity?.id === item.id ? "bg-white/20" : ACTIVITY_COLORS[item.activityType]
                          )}>
                            {(() => { const Icon = ACTIVITY_ICONS[item.activityType]; return <Icon className="w-6 h-6 lg:w-8 lg:h-8" />; })()}
                          </div>
                          <div className="text-left">
                            <p className={cn("text-[10px] lg:text-sm font-black uppercase tracking-widest mb-0.5 lg:mb-1", currentActivity?.id === item.id ? "text-blue-100" : "text-slate-400")}>
                              {item.order + 1}교시
                            </p>
                            <h3 className="text-xl lg:text-3xl font-black">{item.activityName}</h3>
                          </div>
                        </div>
                        <div className="w-full sm:w-auto text-left sm:text-right border-t sm:border-none pt-2 sm:pt-0 border-white/10">
                          <p className={cn("text-lg lg:text-2xl font-mono font-black", currentActivity?.id === item.id ? "text-white" : "text-slate-400")}>
                            {item.startTime} - {item.endTime}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              ) : currentActivity ? (
                <motion.div key={currentActivity.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.1 }} className="w-full">
                  <div className={cn("inline-flex items-center gap-4 px-10 py-4 rounded-full mb-12 font-black text-xl uppercase tracking-widest border-4", ACTIVITY_COLORS[currentActivity.activityType])}>
                    {(() => { const Icon = ACTIVITY_ICONS[currentActivity.activityType]; return <Icon className="w-8 h-8" />; })()}
                    {currentActivity.activityType === 'morning' ? '아침 활동' : currentActivity.activityType === 'lunch' ? '점심 시간' : currentActivity.activityType === 'break' ? '쉬는 시간' : '수업 진행 중'}
                  </div>

                  <h2 className="text-4xl sm:text-7xl lg:text-[18rem] font-black text-slate-900 leading-none tracking-tighter mb-8 lg:mb-12 break-words px-4 overflow-hidden">
                    {currentActivity.activityName}
                  </h2>

                  <div className="flex flex-col md:flex-row items-center justify-center gap-16">
                    {displaySettings.showCountdown && (
                      <div className="text-center">
                        <p className="text-slate-400 font-black uppercase tracking-widest text-lg mb-4">남은 시간</p>
                        <div className="text-[10rem] font-mono font-black text-blue-600 leading-none">
                          {(() => {
                            const today = format(currentTime, 'yyyy-MM-dd');
                            const end = parse(`${today} ${currentActivity.endTime}`, 'yyyy-MM-dd HH:mm', new Date());
                            const diff = differenceInSeconds(end, currentTime);
                            if (diff < 0) return '00:00';
                            const mins = Math.floor(diff / 60);
                            const secs = diff % 60;
                            return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                          })()}
                        </div>
                      </div>
                    )}
                    <div className="bg-slate-50 p-12 rounded-[40px] border-4 border-slate-100">
                      <p className="text-slate-400 font-black uppercase tracking-widest text-lg mb-4">활동 시간</p>
                      <p className="text-7xl font-black text-slate-800">{currentActivity.startTime} - {currentActivity.endTime}</p>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="text-slate-200">
                  <Moon className="w-40 h-40 mx-auto mb-8 opacity-20" />
                  <h2 className="text-6xl font-black">진행 중인 활동이 없습니다</h2>
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* Next Activity Preview */}
          {displaySettings.showNextActivity && nextActivity && (
            <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} className="mt-auto">
              <div className="bg-slate-900 rounded-[40px] p-12 text-white flex items-center justify-between shadow-2xl">
                <div className="flex items-center gap-10">
                  <div className="w-24 h-24 bg-white/10 rounded-[32px] flex items-center justify-center">
                    {(() => { const Icon = ACTIVITY_ICONS[nextActivity.activityType]; return <Icon className="w-12 h-12 text-blue-400" />; })()}
                  </div>
                  <div>
                    <p className="text-blue-400 font-black uppercase tracking-widest text-sm mb-2">다음 활동 예고</p>
                    <h3 className="text-6xl font-black">{nextActivity.activityName}</h3>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-white/30 font-black uppercase tracking-widest text-sm mb-2">시작 시간</p>
                  <p className="text-7xl font-mono font-black">{nextActivity.startTime}</p>
                </div>
              </div>
            </motion.div>
          )}
        </main>
        
        {/* Teacher Return Button */}
        {user && user.uid === teacherId && (
          <button 
            onClick={() => setView('teacher')}
            className="fixed bottom-8 right-8 p-4 bg-white/80 backdrop-blur-md text-slate-900 rounded-2xl shadow-2xl border border-slate-200 font-bold flex items-center gap-2 hover:bg-white transition-all z-40"
          >
            <Settings className="w-5 h-5" /> 관리자 화면으로 돌아가기
          </button>
        )}

        {/* Full Screen Alert Overlay */}
        <AnimatePresence>
          {showFullScreen && currentActivity && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-blue-600 flex flex-col items-center justify-center p-20 text-center">
              <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="w-full">
                <div className="inline-flex items-center gap-6 px-12 py-4 bg-white/10 rounded-full mb-20 text-white font-black text-2xl tracking-widest uppercase">
                  <Play className="w-10 h-10 fill-current" /> 활동 시작 알림
                </div>
                <h2 className="text-[20rem] font-black text-white leading-none tracking-tighter mb-20">{currentActivity.activityName}</h2>
                <div className="text-7xl font-black text-blue-100 flex items-center justify-center gap-12">
                  <span>{currentActivity.startTime}</span>
                  <div className="w-24 h-2 bg-blue-400 rounded-full" />
                  <span>{currentActivity.endTime}</span>
                </div>
                <button onClick={() => setShowFullScreen(false)} className="mt-32 px-20 py-8 bg-white text-blue-600 rounded-[32px] font-black text-4xl shadow-2xl hover:scale-105 transition-all">확인했습니다</button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Toast Notification */}
        <AnimatePresence>
          {toastMessage && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-slate-900 text-white px-6 py-3 rounded-2xl font-bold shadow-2xl flex items-center gap-3"
            >
              <Check className="w-5 h-5 text-green-400" />
              {toastMessage}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return null;
}
