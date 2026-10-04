// Voice capture via the browser's Web Speech API. IMPORTANT: unlike the rest
// of Daywell, this is NOT guaranteed local or offline — most browsers send the
// audio to a speech-recognition service. It is feature-detected and optional;
// callers must disclose this to the user (the UI does, next to the mic).

export function voiceSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Starts recognition. Calls onInterim(partial) live as you speak, onResult(text)
// with the final transcript, and onEnd() when done. Returns a stop() function,
// or null if unsupported.
export function startVoice({ onResult, onInterim, onError, onEnd, continuous = false }) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) { if (onError) onError('Voice input is not supported in this browser.'); return null; }
  const rec = new Ctor();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = true; // live transcription for a seamless feel
  rec.continuous = !!continuous; // keep listening (used for wake-word mode)
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    let finalT = ''; let interimT = '';
    for (const r of e.results) { if (r.isFinal) finalT += r[0].transcript; else interimT += r[0].transcript; }
    const live = `${finalT} ${interimT}`.trim();
    if (live && onInterim) onInterim(live);
    if (finalT.trim() && onResult) onResult(finalT.trim());
  };
  rec.onerror = (e) => { if (onError) onError(e.error || 'Voice recognition error.'); };
  rec.onend = () => { if (onEnd) onEnd(); };
  try { rec.start(); } catch (err) { if (onError) onError('Could not start voice input.'); return null; }
  return () => { try { rec.stop(); } catch { /* ignore */ } };
}
