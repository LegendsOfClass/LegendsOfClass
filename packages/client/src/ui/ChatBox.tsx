import { useEffect, useRef, useState } from 'react';
import { EventBus } from '../EventBus';
import { t } from '../i18n';
import { rtSendChat } from '../net/realtime';

interface ChatMsg { id: string; name: string; text: string; ts: number; self?: boolean }

/** Map chat (M2). Renders as plain text nodes — chat content can never run as HTML. */
export function ChatBox() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState<'online' | 'offline'>('offline');
  const [cooldown, setCooldown] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offs = [
      EventBus.on('rt-chat', (m: ChatMsg) => {
        setMsgs(prev => [...prev.slice(-49), m]);
      }),
      EventBus.on('rt-status', (s: 'online' | 'offline') => setStatus(s)),
      EventBus.on('rt-chat-cooldown', () => { setCooldown(true); setTimeout(() => setCooldown(false), 1200); }),
      EventBus.on('rt-welcome', () => setMsgs([])), // new channel, fresh log
    ];
    return () => offs.forEach(o => o());
  }, []);

  useEffect(() => { listRef.current?.scrollTo(0, 99999); }, [msgs, open]);

  function send() {
    const text = input.trim();
    if (!text) return;
    rtSendChat(text);
    setInput('');
  }

  return (
    <div style={{
      position: 'fixed', left: 10, bottom: 64, width: 280, zIndex: 40,
      background: 'rgba(10,14,24,.82)', border: '1px solid #3a4664', borderRadius: 10,
      fontSize: 13, color: '#e8ecf5', backdropFilter: 'blur(2px)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}>
        <span>💬 {t('ui.chat.title')} <span style={{ color: status === 'online' ? '#6de08a' : '#e0866d', fontSize: 11 }}>
          ● {t(status === 'online' ? 'ui.chat.online' : 'ui.chat.offline')}</span></span>
        <span style={{ opacity: .7 }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <>
          <div ref={listRef} style={{ height: 130, overflowY: 'auto', padding: '2px 8px', lineHeight: 1.5 }}>
            {msgs.length === 0 && <div style={{ opacity: .5, fontSize: 12 }}>{t('ui.chat.empty')}</div>}
            {msgs.map((m, i) => (
              <div key={m.ts + '-' + i} style={{ wordBreak: 'break-word' }}>
                <b style={{ color: '#9db8e8' }}>{m.name}:</b> {m.text}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, padding: 6 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send(); }}
              placeholder={status === 'online' ? t('ui.chat.placeholder') : t('ui.chat.offlineHint')}
              disabled={status !== 'online'}
              maxLength={120}
              style={{ flex: 1, minWidth: 0, background: '#161c2c', color: '#fff', border: '1px solid #3a4664', borderRadius: 6, padding: '4px 8px', fontSize: 13 }}
            />
            <button className="small" disabled={status !== 'online' || cooldown} onClick={send}>
              {cooldown ? '⏳' : t('ui.chat.send')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
