import { useEffect, useState } from 'react';
import { api } from '../api';

export function OfflineNotice() {
  const [llm, setLlm] = useState<'online' | 'offline' | 'unknown'>('unknown');

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

  const retry = () => {
    api
      .status()
      .then((s) => setLlm(s.llm))
      .catch(() => setLlm('offline'));
  };

  if (llm !== 'offline') return null;

  return (
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
  );
}
