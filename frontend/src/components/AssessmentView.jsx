import React, { useState, useEffect, useRef } from 'react';
import { languages } from '../data/languages.js';
import { formTranslations } from '../data/i18n.js';

function applyTranslation(targetForm, targetLang) {
  if (!targetForm || !targetLang || targetLang === 'en') return targetForm;
  const translation = formTranslations?.[targetForm.formId]?.[targetLang];
  if (translation) {
    return {
      ...targetForm,
      language: targetLang,
      title: translation.title || targetForm.title,
      instructions: translation.instructions || targetForm.instructions,
      options: translation.options || targetForm.options,
      questions: translation.questions || targetForm.questions,
    };
  }
  return targetForm;
}

export default function AssessmentView({
  prescriptionId,
  initialLanguage = 'en',
  onFinishAssessment,
}) {
  const [form, setForm] = useState(null);
  const [prescription, setPrescription] = useState(null);
  const [language, setLanguage] = useState(initialLanguage);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [conversationMode, setConversationMode] = useState('text');
  const [micActive, setMicActive] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);

  // Load prescription & form
  useEffect(() => {
    async function init() {
      setLoading(true);
      setError('');
      try {
        let formIdToLoad = 'phq9';
        if (prescriptionId) {
          const pRes = await fetch(`/api/prescriptions/${encodeURIComponent(prescriptionId)}`);
          if (pRes.ok) {
            const pData = await pRes.json();
            setPrescription(pData);
            if (pData.formId) formIdToLoad = pData.formId;
            if (pData.language && !initialLanguage) setLanguage(pData.language);
          }
        }

        const fRes = await fetch(`/api/form?formId=${encodeURIComponent(formIdToLoad)}&language=${encodeURIComponent(language)}`);
        if (!fRes.ok) throw new Error('Could not load assessment form.');
        const fData = await fRes.json();
        setForm(applyTranslation(fData, language));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [prescriptionId, language]);

  // Handle Camera toggle
  async function toggleCamera() {
    if (cameraActive) {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      setCameraActive(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        mediaStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCameraActive(true);
      } catch (err) {
        alert('Camera access denied or unavailable: ' + err.message);
      }
    }
  }

  function handleSelectOption(value) {
    const nextAnswers = { ...answers, [currentIndex + 1]: value };
    setAnswers(nextAnswers);

    if (form && currentIndex + 1 < form.questions.length) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setIsReviewMode(true);
    }
  }

  async function handleFinalize() {
    if (!form) return;
    setSubmitting(true);
    setError('');

    const formattedAnswers = form.questions.map((_, i) => answers[i + 1] ?? 0);
    try {
      const res = await fetch('/api/results', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prescriptionId: prescriptionId || undefined,
          formId: form.formId,
          answers: formattedAnswers,
          language,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit report');

      if (onFinishAssessment) {
        onFinishAssessment(data.resultId || prescriptionId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="panel" style={{ textAlign: 'center', padding: '40px' }}>Loading assessment questionnaire...</div>;
  }

  if (error && !form) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: '40px' }}>
        <div className="safety-alert">{error}</div>
      </div>
    );
  }

  const currentQuestion = form?.questions?.[currentIndex];
  const options = form?.options || [
    { value: 0, label: 'Not at all', description: 'Not at all in the last two weeks' },
    { value: 1, label: 'Several days', description: 'Several days in the last two weeks' },
    { value: 2, label: 'More than half the days', description: 'More than half the days in the last two weeks' },
    { value: 3, label: 'Nearly every day', description: 'Nearly every day in the last two weeks' },
  ];

  const answeredCount = Object.keys(answers).length;
  const totalCount = form?.questions?.length || 9;

  return (
    <div>
      <div className="controls-bar">
        <div>
          <span className="pill-badge live" style={{ marginRight: '10px' }}>
            {prescription?.patient?.label ? `Patient: ${prescription.patient.label}` : 'Direct Assessment'}
          </span>
          <span className="pill-badge off">
            {answeredCount} / {totalCount} answered
          </span>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <select
            className="sidebar-language-select"
            value={conversationMode}
            onChange={(e) => setConversationMode(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="text">Text conversation</option>
            <option value="voice">Voice conversation</option>
          </select>

          <select
            className="sidebar-language-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            style={{ width: 'auto' }}
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: '20px' }}>
        {/* Questionnaire Area */}
        <div>
          {!isReviewMode && currentQuestion && (
            <article className="assessment-card">
              <span className="question-badge">
                Question {String(currentIndex + 1).padStart(2, '0')} of {totalCount}
              </span>
              <h2 className="question-text">{currentQuestion.text}</h2>
              <p className="question-instruction">
                {form.instructions || 'Over the last 2 weeks, how often have you been bothered by this problem?'}
              </p>

              <div className="options-grid">
                {options.map((opt) => {
                  const isSelected = answers[currentIndex + 1] === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={`option-btn ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleSelectOption(opt.value)}
                    >
                      <div className="option-val">{opt.value}</div>
                      <div>
                        <div className="option-label">{opt.label}</div>
                        <div className="option-desc">{opt.description}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="actions" style={{ justifyContent: 'space-between', marginTop: '24px' }}>
                <button
                  className="button outline"
                  type="button"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                >
                  Previous
                </button>
                <button
                  className="button outline"
                  type="button"
                  disabled={currentIndex + 1 >= totalCount}
                  onClick={() => setCurrentIndex((prev) => prev + 1)}
                >
                  Skip to Next
                </button>
              </div>
            </article>
          )}

          {isReviewMode && (
            <article className="assessment-card">
              <span className="question-badge">Final Review</span>
              <h2 className="question-text">Review your answers</h2>
              <p className="question-instruction">
                Please verify your answers before submitting the completed report. You can modify any item below.
              </p>

              <div style={{ display: 'grid', gap: '14px', margin: '20px 0' }}>
                {form.questions.map((q, idx) => {
                  const qNum = idx + 1;
                  const chosenVal = answers[qNum] ?? 0;
                  return (
                    <div
                      key={q.id || idx}
                      style={{
                        padding: '14px 18px',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        background: '#f8fafc',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ maxWidth: '70%' }}>
                        <strong>
                          {qNum}. {q.text}
                        </strong>
                      </div>
                      <select
                        className="sidebar-language-select"
                        value={chosenVal}
                        onChange={(e) => setAnswers({ ...answers, [qNum]: Number(e.target.value) })}
                        style={{ width: '160px' }}
                      >
                        {options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.value} - {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              <div className="actions">
                <button className="button outline" type="button" onClick={() => setIsReviewMode(false)}>
                  Back to questions
                </button>
                <button
                  className="button primary"
                  type="button"
                  disabled={submitting}
                  onClick={handleFinalize}
                >
                  {submitting ? 'Generating Report...' : 'Confirm answers & generate report'}
                </button>
              </div>
            </article>
          )}
        </div>

        {/* Live Session / Camera Panel */}
        <aside>
          <div className="panel" style={{ padding: '16px' }}>
            <h3 style={{ fontSize: '13px', letterSpacing: '0.05em', color: '#64748b', marginBottom: '12px' }}>
              LIVE SESSION
            </h3>

            <div
              style={{
                width: '100%',
                height: '140px',
                background: '#f1f5f9',
                borderRadius: '8px',
                display: 'grid',
                placeItems: 'center',
                overflow: 'hidden',
                position: 'relative',
                marginBottom: '12px',
              }}
            >
              {cameraActive ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>Camera is off</span>
              )}
            </div>

            <div style={{ display: 'grid', gap: '8px' }}>
              <button
                type="button"
                className="button outline"
                style={{ fontSize: '12px', padding: '8px 12px' }}
                onClick={() => setMicActive(!micActive)}
              >
                {micActive ? 'Turn microphone off' : 'Turn microphone on'}
              </button>
              <button
                type="button"
                className="button outline"
                style={{ fontSize: '12px', padding: '8px 12px' }}
                onClick={toggleCamera}
              >
                {cameraActive ? 'Turn camera off' : 'Turn camera on'}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
