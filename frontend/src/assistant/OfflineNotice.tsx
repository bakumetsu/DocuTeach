import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAiNotice, clearAiNotice } from './aiNotice';

export function OfflineNotice() {
  const [llm, setLlm] = useState<'online' | 'offline' | 'unknown'>('unknown');
  const notice = useAiNotice((s) => s.notice);

  useEffect(() => {
    let cancelled = false;
    api
      .status()
      .then((s) => {
        if (!cancelled) setLlm(s.llm);
      })
      .catch(() => {
        if (!cancelled) setLlm('offline');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const offline = llm === 'offline' || notice === 'offline';

  useEffect(() => {
    if (!offline) return;
    const id = setInterval(() => {
      api
        .status()
        .then((s) => {
          setLlm(s.llm);
          if (s.llm === 'online') clearAiNotice();
        })
        .catch(() => setLlm('offline'));
    }, 15000);
    return () => clearInterval(id);
  }, [offline]);

  const retry = () => {
    api
      .status()
      .then((s) => {
        setLlm(s.llm);
        if (s.llm === 'online') clearAiNotice();
      })
      .catch(() => setLlm('offline'));
  };

  if (!offline && notice !== 'busy') return null;

  return (
    <>
      {offline && (
        <div
          className="offline-notice"
          role="status"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}
        >
          <span>AI offline: editing and export still work</span>
          <button className="retry-btn" onClick={retry}>
            Retry
          </button>
        </div>
      )}
      {!offline && notice === 'busy' && (
        <div
          className="offline-notice"
          role="status"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}
        >
          <span>AI is busy, try again in a moment</span>
          <button className="retry-btn" onClick={retry}>
            Retry
          </button>
        </div>
      )}
    </>
  );
}
