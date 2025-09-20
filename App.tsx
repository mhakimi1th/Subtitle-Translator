import React, { useState, useCallback, useEffect } from 'react';
import { Header } from './components/Header';
import { FileUpload } from './components/FileUpload';
import { ProcessingView } from './components/ProcessingView';
import { DownloadView } from './components/DownloadView';
import { ErrorView } from './components/ErrorView';
import { Settings } from './components/Settings';
import { StatusIndicators } from './components/StatusIndicators';
import { parseSrt, reconstructSrt, parseSrtTimestampToMs, formatMsToSrtTimestamp } from './utils/subtitleParser';
import { translateSubtitleContent } from './services/geminiService';
import type { SubtitleBlock } from './types';

type Status = 'idle' | 'parsing' | 'translating' | 'done' | 'error';
type AIStatus = 'ready' | 'active' | 'error';

export default function App(): React.ReactElement {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [translatedContent, setTranslatedContent] = useState<string | null>(null);
  const [originalFileName, setOriginalFileName] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  
  // States for live translation view
  const [originalSubtitles, setOriginalSubtitles] = useState<SubtitleBlock[]>([]);
  const [liveTranslatedText, setLiveTranslatedText] = useState<Record<number, string>>({});

  // States for other features
  const [logs, setLogs] = useState<string[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [internetStatus, setInternetStatus] = useState<'online' | 'offline'>(navigator.onLine ? 'online' : 'offline');
  const [aiStatus, setAiStatus] = useState<AIStatus>('ready');
  const [showSettings, setShowSettings] = useState(false);
  
  // Settings State
  const [customApiKey, setCustomApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');
  const [customHeaderText, setCustomHeaderText] = useState('ترجمه شده توسط سیستم پیشرفته مترجم طراحی شده توسط محمد حکیمی نیا');
  const [headerColor, setHeaderColor] = useState('#33b3b3');
  const [customFooterText, setCustomFooterText] = useState('');
  const [footerColor, setFooterColor] = useState('#808080');

  useEffect(() => {
    const handleOnline = () => {
      setInternetStatus('online');
      if (aiStatus !== 'active') setAiStatus('ready');
    };
    const handleOffline = () => {
      setInternetStatus('offline');
      setAiStatus('error');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [aiStatus]);

  useEffect(() => {
    let interval: number | undefined;
    if (status === 'translating') {
      interval = window.setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    } else if (status === 'done' || status === 'error') {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [status]);
  
  useEffect(() => {
    try {
      const storedKey = localStorage.getItem('gemini_api_key');
      if (storedKey) setCustomApiKey(storedKey);

      const storedHeaderText = localStorage.getItem('custom_header_text');
      if (storedHeaderText !== null) setCustomHeaderText(storedHeaderText);
      
      const storedHeaderColor = localStorage.getItem('custom_header_color');
      if (storedHeaderColor) setHeaderColor(storedHeaderColor);

      const storedFooterText = localStorage.getItem('custom_footer_text');
      if (storedFooterText !== null) setCustomFooterText(storedFooterText);

      const storedFooterColor = localStorage.getItem('custom_footer_color');
      if (storedFooterColor) setFooterColor(storedFooterColor);

    } catch (error) {
      console.error("Could not read settings from local storage:", error);
    }
  }, []);

  const handleApiKeyChange = (key: string) => {
    setCustomApiKey(key);
    try { localStorage.setItem('gemini_api_key', key); } catch (e) { console.error("Could not save API key:", e); }
  };
  const handleHeaderTextChange = (text: string) => {
    setCustomHeaderText(text);
    try { localStorage.setItem('custom_header_text', text); } catch (e) { console.error("Could not save header text:", e); }
  };
  const handleHeaderColorChange = (color: string) => {
    setHeaderColor(color);
    try { localStorage.setItem('custom_header_color', color); } catch (e) { console.error("Could not save header color:", e); }
  };
  const handleFooterTextChange = (text: string) => {
    setCustomFooterText(text);
    try { localStorage.setItem('custom_footer_text', text); } catch (e) { console.error("Could not save footer text:", e); }
  };
  const handleFooterColorChange = (color: string) => {
    setFooterColor(color);
    try { localStorage.setItem('custom_footer_color', color); } catch (e) { console.error("Could not save footer color:", e); }
  };


  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('fa-IR', { hour12: false });
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const handleFileChange = (selectedFile: File | null) => {
    if (selectedFile) {
      if (!selectedFile.name.toLowerCase().endsWith('.srt')) {
          handleReset();
          setErrorMessage('لطفا یک فایل با فرمت .srt انتخاب کنید.');
          setStatus('error');
          return;
      }
      setFile(selectedFile);
      setOriginalFileName(selectedFile.name);
      setStatus('idle');
      setTranslatedContent(null);
      setErrorMessage('');
    }
  };
  
  const handleTranslate = useCallback(async () => {
    if (!file) {
      setErrorMessage('هیچ فایلی انتخاب نشده است.');
      setStatus('error');
      return;
    }

    setLogs([]);
    setElapsedTime(0);
    setLiveTranslatedText({});
    addLog('فرآیند شروع شد.');
    setAiStatus('active');
    setStatus('parsing');
    
    try {
      const fileContent = await file.text();
      addLog('فایل خوانده شد.');
      const parsedSubtitles = parseSrt(fileContent);
      setOriginalSubtitles(parsedSubtitles);
      addLog(`فایل با موفقیت پردازش شد. ${parsedSubtitles.length} خط زیرنویس یافت شد.`);

      if (parsedSubtitles.length === 0) {
        throw new Error('فایل زیرنویس خالی است یا فرمت معتبری ندارد.');
      }

      setStatus('translating');

      const handleProgress = (translatedBatch: Record<number, string>) => {
        setLiveTranslatedText(prev => ({ ...prev, ...translatedBatch }));
      };
      
      const allTranslatedTexts = await translateSubtitleContent({
        subtitles: parsedSubtitles,
        apiKey: customApiKey,
        model: selectedModel,
        addLog,
        onProgress: handleProgress,
      });

      const updatedSubtitles: SubtitleBlock[] = parsedSubtitles.map(block => ({
        ...block,
        text: allTranslatedTexts[block.index] || block.text,
      }));

      addLog('افزودن متن‌های شخصی‌سازی شده و ساخت فایل نهایی...');
      
      let processedSubtitles: SubtitleBlock[] = [...updatedSubtitles];

      // Prepend header text if it exists
      if (customHeaderText.trim()) {
        const coloredHeaderText = `<font color="${headerColor}">${customHeaderText.trim()}</font>`;
        const headerBlock: SubtitleBlock = {
          index: 1,
          timestamp: '00:00:01,000 --> 00:00:06,000',
          text: coloredHeaderText,
        };
        const reIndexed = processedSubtitles.map(sub => ({ ...sub, index: sub.index + 1 }));
        processedSubtitles = [headerBlock, ...reIndexed];
      }

      // Append footer text if it exists
      if (customFooterText.trim() && processedSubtitles.length > 0) {
        const lastBlock = processedSubtitles[processedSubtitles.length - 1];
        const lastTimestampEnd = lastBlock.timestamp.split(' --> ')[1];
        const footerStartMs = parseSrtTimestampToMs(lastTimestampEnd) + 1000; // 1 second after last sub
        const footerEndMs = footerStartMs + 5000; // 5 seconds duration

        const coloredFooterText = `<font color="${footerColor}">${customFooterText.trim()}</font>`;
        const footerBlock: SubtitleBlock = {
          index: lastBlock.index + 1,
          timestamp: `${formatMsToSrtTimestamp(footerStartMs)} --> ${formatMsToSrtTimestamp(footerEndMs)}`,
          text: coloredFooterText,
        };
        processedSubtitles.push(footerBlock);
      }
      
      const finalSrt = reconstructSrt(processedSubtitles);
      setTranslatedContent(finalSrt);

      addLog('ترجمه با موفقیت به پایان رسید!');
      setStatus('done');
      setAiStatus('ready');
    } catch (error) {
      console.error('Translation process failed:', error);
      const message = error instanceof Error ? error.message : 'یک خطای ناشناخته رخ داد.';
      addLog(`خطا: ${message}`);
      setErrorMessage(`ترجمه با خطا مواجه شد: ${message}`);
      setStatus('error');
      setAiStatus('error');
    }
  }, [file, customApiKey, selectedModel, customHeaderText, headerColor, customFooterText, footerColor]);

  const handleReset = () => {
    setFile(null);
    setStatus('idle');
    setTranslatedContent(null);
    setOriginalFileName('');
    setErrorMessage('');
    setLogs([]);
    setElapsedTime(0);
    setOriginalSubtitles([]);
    setLiveTranslatedText({});
    if(internetStatus === 'online') setAiStatus('ready');
  };

  const renderContent = () => {
    switch (status) {
      case 'parsing':
      case 'translating':
        return <ProcessingView 
                  status={status} 
                  elapsedTime={elapsedTime} 
                  originalSubtitles={originalSubtitles}
                  translatedSubtitles={liveTranslatedText}
                />;
      case 'done':
        return (
          <DownloadView
            fileName={originalFileName}
            fileContent={translatedContent || ''}
            onReset={handleReset}
          />
        );
      case 'error':
        return <ErrorView message={errorMessage} onReset={handleReset} />;
      case 'idle':
      default:
        return (
          <FileUpload
            onFileSelect={handleFileChange}
            onTranslate={handleTranslate}
            file={file}
          />
        );
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen flex flex-col items-center justify-center p-4 text-gray-800" dir="rtl">
      <div className="w-full max-w-4xl mx-auto">
        <Header onToggleSettings={() => setShowSettings(!showSettings)} />
        <main className="bg-white rounded-xl shadow-lg p-6 sm:p-8 mt-6 transition-all duration-300">
          <div className="flex justify-end mb-4">
            <StatusIndicators internetStatus={internetStatus} aiStatus={aiStatus} />
          </div>

          {showSettings && (
            <Settings
              apiKey={customApiKey}
              onApiKeyChange={handleApiKeyChange}
              model={selectedModel}
              onModelChange={setSelectedModel}
              headerText={customHeaderText}
              onHeaderTextChange={handleHeaderTextChange}
              headerColor={headerColor}
              onHeaderColorChange={handleHeaderColorChange}
              footerText={customFooterText}
              onFooterTextChange={handleFooterTextChange}
              footerColor={footerColor}
              onFooterColorChange={handleFooterColorChange}
            />
          )}

          <div className={showSettings ? 'mt-4 pt-4 border-t border-gray-200' : ''}>
            {renderContent()}
          </div>
        </main>
        <footer className="text-center mt-6 text-sm text-gray-500">
          <p>طراحی شده توسط محمد حکیمی نیا</p>
        </footer>
      </div>
    </div>
  );
}