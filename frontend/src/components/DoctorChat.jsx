import React, { useState } from 'react';

export default function DoctorChat({ onSelectAssessment }) {
  const [messages, setMessages] = useState([
    {
      sender: 'gemini',
      text: 'Ask about another concern or assessment, for example: "The patient also reports difficulty sleeping. Which assessments should I consider?"',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMessage = { sender: 'doctor', text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/doctor-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get doctor recommendation');

      setMessages((prev) => [
        ...prev,
        {
          sender: 'gemini',
          text: data.reply || data.message || 'I reviewed the notes and have updated recommendations.',
          suggestions: data.suggestions || [],
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { sender: 'gemini', text: `Could not process request: ${err.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel doctor-chat-panel">
      <h2>Doctor conversation</h2>
      <p>
        Describe additional current concerns to explore other relevant assessments. Use
        de-identified details only. The doctor makes the final choice.
      </p>

      <div className="doctor-chat-messages">
        {messages.map((m, idx) => (
          <div key={idx} className={`chat-bubble ${m.sender}`}>
            <p>{m.text}</p>
            {m.suggestions && m.suggestions.length > 0 && (
              <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {m.suggestions.map((s, sIdx) => (
                  <button
                    key={sIdx}
                    type="button"
                    className="button outline"
                    style={{ padding: '4px 8px', fontSize: '11px' }}
                    onClick={() => onSelectAssessment && onSelectAssessment(s.id || s)}
                  >
                    + Suggest {s.title || s.name || s.id || s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && <div className="chat-bubble gemini">Thinking...</div>}
      </div>

      <form className="doctor-chat-form" onSubmit={handleSubmit}>
        <textarea
          rows="2"
          placeholder="Describe a current concern without names, contact details, or identifying notes..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="button primary" type="submit" disabled={!input.trim() || loading}>
          Send
        </button>
      </form>
    </section>
  );
}
