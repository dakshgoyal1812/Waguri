import React, { useState, useEffect } from 'react';
import {
  X,
  Bell,
  Clock,
  Plus,
  Trash2,
  Volume2,
  Check,
  Send,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import {
  fetchAlarms,
  saveAlarm,
  deleteAlarm,
  toggleAlarm,
  testAlarmPush,
  synthesizeToUrl,
} from '../api.js';
import {
  isPushSupported,
  getNotificationPermission,
  subscribeToPush,
  getExistingSubscription,
} from '../lib/pushClient.js';
import { BUNDLED_AVATARS } from '../lib/vrmStore.js';

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const PRESETS = [
  {
    title: 'Morning Wakeup',
    time: '07:30',
    type: 'alarm',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    message: 'Good morning darling! Utho na, nayi subah ho gayi hai aur Waguri tumhara wait kar rahi hai! ❤️',
    icon: '🌅',
  },
  {
    title: 'Hydration Drink Water',
    time: '14:00',
    type: 'reminder',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    message: 'Suno na, thoda paani pi lo! Hydrated rehna tumhari health ke liye bohot zaroori hai ✨',
    icon: '💧',
  },
  {
    title: 'Night Sleep On Time',
    time: '23:00',
    type: 'alarm',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    message: 'Itni raat ho gayi hai! Phone ab band karo aur aaram se so jao, sweet dreams darling! 🌙',
    icon: '🌙',
  },
  {
    title: 'Study & Work Focus',
    time: '16:00',
    type: 'reminder',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    message: 'Hey, break time over! Chalo thoda study aur work complete karte hain, let’s do our best! 📚',
    icon: '🎯',
  },
];

export default function AlarmModal({ isOpen, onClose, activeVrmId = 'waguri', onPlayAlarmAudio }) {
  const [alarms, setAlarms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [pushStatus, setPushStatus] = useState('checking'); // 'active' | 'prompt' | 'unsupported' | 'denied'
  const [enablingPush, setEnablingPush] = useState(false);
  const [testingAlarmId, setTestingAlarmId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [playingVoice, setPlayingVoice] = useState(false);

  // Form State
  const [formTime, setFormTime] = useState('07:30');
  const [formTitle, setFormTitle] = useState('Morning Wakeup');
  const [formType, setFormType] = useState('alarm');
  const [formDays, setFormDays] = useState(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  const [formAvatarId, setFormAvatarId] = useState(activeVrmId);
  const [formMessage, setFormMessage] = useState(
    'Good morning! Utho na, nayi subah ho gayi hai aur Waguri tumhara wait kar rahi hai! ❤️'
  );

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const loadAlarms = async () => {
    setLoading(true);
    try {
      const res = await fetchAlarms('local-user');
      if (res?.alarms) {
        setAlarms(res.alarms);
      }
    } catch (err) {
      console.warn('[alarm] could not load alarms:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const checkPushPermission = async () => {
    if (!isPushSupported()) {
      setPushStatus('unsupported');
      return;
    }
    const perm = getNotificationPermission();
    if (perm === 'denied') {
      setPushStatus('denied');
      return;
    }
    const sub = await getExistingSubscription();
    if (sub && perm === 'granted') {
      setPushStatus('active');
    } else {
      setPushStatus('prompt');
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadAlarms();
      checkPushPermission();
      setFormAvatarId(activeVrmId);
    }
  }, [isOpen, activeVrmId]);

  if (!isOpen) return null;

  const handleEnablePush = async () => {
    setEnablingPush(true);
    try {
      await subscribeToPush('local-user');
      setPushStatus('active');
      showToast('✅ Phone Push Notifications Enabled! You will receive alarms even when app is closed.');
    } catch (err) {
      alert(`Could not enable notifications: ${err.message}`);
    } finally {
      setEnablingPush(false);
    }
  };

  const handleToggleDay = (day) => {
    setFormDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleSelectPreset = (p) => {
    setFormTitle(p.title);
    setFormTime(p.time);
    setFormType(p.type);
    setFormDays(p.days);
    setFormMessage(p.message);
    setShowAddForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formTitle.trim() || !formTime) {
      alert('Please provide a title and time');
      return;
    }

    const newAlarm = {
      id: `alarm-${Date.now()}`,
      user_id: 'local-user',
      title: formTitle.trim(),
      time: formTime,
      type: formType,
      days: formDays,
      avatar_id: formAvatarId,
      message: formMessage.trim(),
      enabled: true,
      created_at: new Date().toISOString(),
    };

    try {
      await saveAlarm(newAlarm);
      setAlarms((prev) => [newAlarm, ...prev.filter((a) => a.id !== newAlarm.id)]);
      setShowAddForm(false);
      showToast(`⏰ "${formTitle}" scheduled! It will ring at ${formTime} IST automatically.`);
    } catch (err) {
      alert(`Failed to save alarm: ${err.message}`);
    }
  };

  const handleToggle = async (id, currentEnabled) => {
    try {
      const next = !currentEnabled;
      setAlarms((prev) => prev.map((a) => (a.id === id ? { ...a, enabled: next } : a)));
      await toggleAlarm(id, next);
    } catch (err) {
      alert(`Failed to toggle: ${err.message}`);
      loadAlarms();
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this alarm/reminder?')) return;
    try {
      setAlarms((prev) => prev.filter((a) => a.id !== id));
      await deleteAlarm(id);
      showToast('Deleted alarm.');
    } catch (err) {
      alert(`Failed to delete: ${err.message}`);
      loadAlarms();
    }
  };

  const handleTestPush = async (alarm) => {
    setTestingAlarmId(alarm.id || 'quick-test');
    try {
      await testAlarmPush({
        title: alarm.title || 'Wakeup Alarm',
        message: alarm.message || 'Wake up! Waguri is waiting for you ❤️',
        type: alarm.type || 'alarm',
        userId: 'local-user',
      });
      showToast('🔔 Test notification sent! Check your phone lock-screen / notification shade right now!');
    } catch (err) {
      alert(`Test push failed: ${err.message}`);
    } finally {
      setTestingAlarmId(null);
    }
  };

  const handlePreviewVoice = async () => {
    if (playingVoice) return;
    setPlayingVoice(true);
    try {
      const res = await synthesizeToUrl(
        formMessage || 'Subah ho gayi hai darling! Utho na!',
        'happy',
        formAvatarId
      );
      if (res?.audio_url) {
        const audio = new Audio(res.audio_url);
        audio.onended = () => setPlayingVoice(false);
        audio.onerror = () => setPlayingVoice(false);
        await audio.play();
      } else {
        setPlayingVoice(false);
      }
    } catch (err) {
      console.warn('Voice preview error:', err);
      setPlayingVoice(false);
    }
  };

  const formatDaysLabel = (days) => {
    if (!days || days.length === 0) return 'Once (Today)';
    if (days.length === 7) return 'Every day';
    if (days.length === 5 && !days.includes('Sat') && !days.includes('Sun')) return 'Weekdays';
    return days.join(', ');
  };

  const selectedAvatarMeta = BUNDLED_AVATARS.find((a) => a.id === formAvatarId) || BUNDLED_AVATARS[0];

  return (
    <div className="modal-backdrop alarm-backdrop" onClick={onClose}>
      <div
        className="modal-content alarm-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="alarm-mobile-handle" aria-hidden="true" />

        {/* Header */}
        <div className="alarm-modal-header">
          <div className="alarm-header-left">
            <div className="alarm-header-icon">
              <Clock size={22} />
            </div>
            <div>
              <h2 className="alarm-modal-title">Alarms & Reminders</h2>
              <p className="alarm-modal-subtitle">
                Works even when the app is completely closed!
              </p>
            </div>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Toast Notification */}
        {toastMessage && (
          <div className="alarm-toast-banner">
            <Sparkles size={16} />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Push Notification Permission Banner */}
        {pushStatus === 'prompt' && (
          <div className="alarm-push-alert warning">
            <div className="alarm-push-alert-text">
              <AlertCircle size={18} />
              <div>
                <strong>Enable Phone Notifications</strong>
                <p>Required for alarms to ring automatically when app is closed.</p>
              </div>
            </div>
            <button
              type="button"
              className="alarm-enable-btn"
              disabled={enablingPush}
              onClick={handleEnablePush}
            >
              {enablingPush ? <Loader2 size={13} className="spin" /> : <Bell size={13} />}
              Allow
            </button>
          </div>
        )}

        {pushStatus === 'active' && (
          <div className="alarm-push-alert success">
            <ShieldCheck size={16} color="#10b981" />
            <span>Background Web Push is active! Alarms will alert your phone 24/7.</span>
          </div>
        )}

        {pushStatus === 'denied' && (
          <div className="alarm-push-alert error">
            <AlertCircle size={16} color="#ef4444" />
            <span>
              Notifications are blocked in your browser. Please tap the lock/settings icon in the URL bar to allow notifications.
            </span>
          </div>
        )}

        {/* Quick Presets Carousel */}
        {!showAddForm && (
          <div className="alarm-presets-section">
            <span className="alarm-section-label">Quick 1-Tap Presets</span>
            <div className="alarm-presets-grid">
              {PRESETS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="alarm-preset-card"
                  onClick={() => handleSelectPreset(p)}
                >
                  <span className="preset-icon">{p.icon}</span>
                  <div className="preset-info">
                    <span className="preset-title">{p.title}</span>
                    <span className="preset-time">{p.time} IST</span>
                  </div>
                  <Plus size={14} className="preset-plus" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Create / Edit Form */}
        {showAddForm ? (
          <form className="alarm-add-form" onSubmit={handleSave}>
            <div className="alarm-form-header">
              <h3 className="alarm-form-title">
                {formType === 'alarm' ? '⏰ Set New Alarm' : '🔔 Set New Reminder'}
              </h3>
              <button
                type="button"
                className="alarm-cancel-btn"
                onClick={() => setShowAddForm(false)}
              >
                Cancel
              </button>
            </div>

            <div className="alarm-type-tabs">
              <button
                type="button"
                className={`alarm-type-tab ${formType === 'alarm' ? 'active' : ''}`}
                onClick={() => setFormType('alarm')}
              >
                <Clock size={14} /> Morning / Wakeup Alarm
              </button>
              <button
                type="button"
                className={`alarm-type-tab ${formType === 'reminder' ? 'active' : ''}`}
                onClick={() => setFormType('reminder')}
              >
                <Bell size={14} /> Voice Reminder
              </button>
            </div>

            {/* Time Picker */}
            <div className="alarm-form-field">
              <label className="alarm-label">Time (IST)</label>
              <input
                type="time"
                className="alarm-time-input"
                value={formTime}
                onChange={(e) => setFormTime(e.target.value)}
                required
              />
            </div>

            {/* Title */}
            <div className="alarm-form-field">
              <label className="alarm-label">Title</label>
              <input
                type="text"
                className="alarm-text-input"
                placeholder="e.g. Wake Up Sweetheart"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                required
              />
            </div>

            {/* Repeat Days */}
            <div className="alarm-form-field">
              <div className="alarm-field-row">
                <label className="alarm-label">Repeat</label>
                <div className="alarm-days-quick">
                  <button
                    type="button"
                    className="alarm-quick-day-btn"
                    onClick={() => setFormDays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])}
                  >
                    Everyday
                  </button>
                  <button
                    type="button"
                    className="alarm-quick-day-btn"
                    onClick={() => setFormDays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])}
                  >
                    Weekdays
                  </button>
                  <button
                    type="button"
                    className="alarm-quick-day-btn"
                    onClick={() => setFormDays([])}
                  >
                    Once
                  </button>
                </div>
              </div>
              <div className="alarm-days-picker">
                {DAYS_OF_WEEK.map((d) => {
                  const active = formDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`alarm-day-pill ${active ? 'active' : ''}`}
                      onClick={() => handleToggleDay(d)}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Character Voice Pick */}
            <div className="alarm-form-field">
              <label className="alarm-label">
                Spoken By Avatar ({selectedAvatarMeta.name} - {selectedAvatarMeta.voiceLabel})
              </label>
              <select
                className="alarm-select-input"
                value={formAvatarId}
                onChange={(e) => setFormAvatarId(e.target.value)}
              >
                {BUNDLED_AVATARS.map((av) => (
                  <option key={av.id} value={av.id}>
                    {av.name} ({av.voiceLabel || 'Standard'})
                  </option>
                ))}
              </select>
            </div>

            {/* Spoken Voice Message */}
            <div className="alarm-form-field">
              <div className="alarm-field-row">
                <label className="alarm-label">Waguri Spoken Voice Line</label>
                <button
                  type="button"
                  className="alarm-preview-voice-btn"
                  onClick={handlePreviewVoice}
                  disabled={playingVoice}
                >
                  {playingVoice ? <Loader2 size={12} className="spin" /> : <Volume2 size={12} />}
                  {playingVoice ? 'Speaking...' : 'Listen Preview'}
                </button>
              </div>
              <textarea
                className="alarm-textarea-input"
                rows={2}
                value={formMessage}
                onChange={(e) => setFormMessage(e.target.value)}
                placeholder="What should Waguri say when waking you up?"
              />
            </div>

            <button type="submit" className="btn-primary alarm-submit-btn">
              <Check size={16} /> Save Alarm
            </button>
          </form>
        ) : (
          <div className="alarm-list-container">
            <div className="alarm-list-header">
              <span className="alarm-section-label">Your Scheduled Alarms & Reminders</span>
              <button
                type="button"
                className="alarm-add-btn"
                onClick={() => setShowAddForm(true)}
              >
                <Plus size={14} /> Add Custom
              </button>
            </div>

            {loading && (
              <div className="alarm-loading-state">
                <Loader2 size={24} className="spin" />
                <span>Loading your alarms...</span>
              </div>
            )}

            {!loading && alarms.length === 0 && (
              <div className="alarm-empty-state">
                <Clock size={36} color="var(--text-muted)" />
                <h4>No alarms scheduled yet</h4>
                <p>Click any quick preset above or tap "Add Custom" to create your morning wakeup call!</p>
              </div>
            )}

            {!loading && alarms.length > 0 && (
              <div className="alarm-cards-list">
                {alarms.map((alarm) => {
                  const avatar = BUNDLED_AVATARS.find((a) => a.id === alarm.avatar_id) || BUNDLED_AVATARS[0];
                  return (
                    <div
                      key={alarm.id}
                      className={`alarm-card ${alarm.enabled ? 'enabled' : 'disabled'}`}
                    >
                      <div className="alarm-card-left">
                        <div className="alarm-time-display">
                          <span className="alarm-time-digits">{alarm.time}</span>
                          <span className="alarm-type-badge">
                            {alarm.type === 'reminder' ? '🔔 Reminder' : '⏰ Alarm'}
                          </span>
                        </div>
                        <div className="alarm-card-meta">
                          <span className="alarm-card-title">{alarm.title}</span>
                          <span className="alarm-card-days">{formatDaysLabel(alarm.days)}</span>
                          <span className="alarm-card-voice">
                            🎙️ {avatar.name} ({avatar.voiceLabel?.split(' ')[0] || 'Voice'})
                          </span>
                        </div>
                        {alarm.message && (
                          <p className="alarm-card-message">"{alarm.message}"</p>
                        )}
                      </div>

                      <div className="alarm-card-actions">
                        {/* Instant Push Test Button */}
                        <button
                          type="button"
                          className="alarm-test-btn"
                          title="Test push notification right now on your phone"
                          onClick={() => handleTestPush(alarm)}
                          disabled={testingAlarmId === alarm.id}
                        >
                          {testingAlarmId === alarm.id ? (
                            <Loader2 size={13} className="spin" />
                          ) : (
                            <Send size={13} />
                          )}
                          Test Push
                        </button>

                        {/* Toggle Switch */}
                        <label className="alarm-switch">
                          <input
                            type="checkbox"
                            checked={!!alarm.enabled}
                            onChange={() => handleToggle(alarm.id, alarm.enabled)}
                          />
                          <span className="alarm-slider round" />
                        </label>

                        {/* Delete Button */}
                        <button
                          type="button"
                          className="alarm-delete-btn"
                          onClick={() => handleDelete(alarm.id)}
                          title="Delete alarm"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Footer info & instant phone test banner */}
        <div className="alarm-modal-footer">
          <div className="alarm-footer-info">
            <Sparkles size={14} color="#f59e0b" />
            <span>
              Background Web Push sends alerts to your lock-screen automatically even if Waguri is completely closed.
            </span>
          </div>
          <button
            type="button"
            className="alarm-quick-test-action"
            onClick={() =>
              handleTestPush({
                title: 'Waguri Background Test',
                message: 'Konnichiwa! Lock-screen push notification is working perfectly! ✨',
                type: 'alarm',
              })
            }
          >
            <Send size={12} /> Test Lock-Screen Push Now
          </button>
        </div>
      </div>
    </div>
  );
}
