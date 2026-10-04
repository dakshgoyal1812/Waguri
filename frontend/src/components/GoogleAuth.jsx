import React, { useState, useEffect, useRef } from 'react';
import {
  LogOut,
  CheckCircle2,
  ShieldCheck,
  User,
  Mail,
  RefreshCw,
  Sparkles,
  AlertCircle,
  X,
  Users,
  KeyRound,
  Send,
} from 'lucide-react';
import {
  supabase,
  isSupabaseConfigured,
  verifyEmailAccess,
  isAdminEmail,
  signInWithGoogle,
  signInWithOtp,
  verifyEmailOtp,
  signOutUser,
  DEFAULT_BYPASS_USER,
} from '../supabaseClient.js';

export { DEFAULT_BYPASS_USER };

export default function GoogleAuth({ onUserChange, onLoadingChange, compact = false }) {
  const [user, setUser] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const menuRef = useRef(null);

  // Form states: Passwordless OTP / Magic Link flow
  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Cooldown timer for resend OTP
  useEffect(() => {
    let timer;
    if (cooldown > 0) {
      timer = setInterval(() => {
        setCooldown((prev) => Math.max(0, prev - 1));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [cooldown]);

  // Close user dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Restore existing session (Supabase session or localStorage)
  useEffect(() => {
    let isMounted = true;

    const restoreSession = async () => {
      // 1. Check Supabase OAuth / OTP / Magic Link session
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email) {
          const clean = session.user.email.trim().toLowerCase();
          const allowed = await verifyEmailAccess(clean);
          if (allowed && isMounted) {
            setUser(session.user);
            onUserChange?.(session.user);
            try {
              localStorage.setItem('waguri_auth_user', JSON.stringify(session.user));
              localStorage.removeItem('waguri_signed_out');
            } catch {}
            onLoadingChange?.(false);
            return;
          } else {
            await signOutUser();
            try { localStorage.removeItem('waguri_auth_user'); } catch {}
          }
        }
      } catch (err) {
        console.warn('[auth] Supabase getSession error:', err?.message);
      }

      // 2. Check stored whitelisted email session in localStorage
      try {
        const isSignedOut = localStorage.getItem('waguri_signed_out') === '1';
        const raw = localStorage.getItem('waguri_auth_user');
        if (raw && !isSignedOut) {
          const parsed = JSON.parse(raw);
          if (parsed?.email) {
            const clean = parsed.email.trim().toLowerCase();
            const allowed = await verifyEmailAccess(clean);
            if (allowed && isMounted) {
              setUser(parsed);
              onUserChange?.(parsed);
              onLoadingChange?.(false);
              return;
            } else {
              localStorage.removeItem('waguri_auth_user');
            }
          }
        }
      } catch (err) {
        console.warn('[auth] Stored auth session error:', err?.message);
      }

      // 3. Fallback: unauthenticated guest mode
      if (isMounted) {
        setUser(null);
        onUserChange?.(null);
        onLoadingChange?.(false);
      }
    };

    restoreSession();

    // Supabase Auth listener for OAuth and Magic Link redirects
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
        if (session?.user?.email) {
          const clean = session.user.email.trim().toLowerCase();
          const allowed = await verifyEmailAccess(clean);
          if (allowed) {
            setUser(session.user);
            onUserChange?.(session.user);
            try {
              localStorage.setItem('waguri_auth_user', JSON.stringify(session.user));
              localStorage.removeItem('waguri_signed_out');
            } catch {}
            // Clean OAuth code or hash tokens from URL if present
            if (typeof window !== 'undefined' && (window.location.search.includes('code=') || window.location.hash.includes('access_token='))) {
              window.history.replaceState({}, document.title, window.location.pathname);
            }
            setErrorMsg('');
            setSuccessMsg('Signed in successfully! ✨');
            setTimeout(() => {
              setIsAuthModalOpen(false);
              setSuccessMsg('');
              setOtpSent(false);
              setOtpCode('');
            }, 600);
          } else {
            setErrorMsg(`Access Denied: Account "${clean}" is not on the admin whitelist.`);
            await signOutUser();
            try { localStorage.removeItem('waguri_auth_user'); } catch {}
            setUser(null);
            onUserChange?.(null);
            setIsAuthModalOpen(true);
          }
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        onUserChange?.(null);
      }
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe?.();
    };
  }, [onUserChange, onLoadingChange]);

  // Handler: Step 1 - Send Confirmation Code / Magic Link
  const handleSendOtp = async (e) => {
    e?.preventDefault?.();
    setErrorMsg('');
    setSuccessMsg('');
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setSigningIn(true);
    try {
      // 1. Verify Whitelist Access
      const allowed = await verifyEmailAccess(cleanEmail);
      if (!allowed) {
        setErrorMsg(
          `Access Denied: "${cleanEmail}" is not on the whitelist. Please ask an admin to add your email in the Admin Portal.`
        );
        return;
      }

      // 2. Request OTP / Magic Link from Supabase
      const { error } = await signInWithOtp(cleanEmail);
      if (error) {
        throw error;
      }

      setOtpSent(true);
      setCooldown(60);
      setSuccessMsg(`Confirmation code and Magic Link sent to ${cleanEmail}! Check your inbox or spam.`);
    } catch (err) {
      console.error('[auth] sendOtp error:', err);
      setErrorMsg(err.message || 'Failed to send confirmation email. Please try again.');
    } finally {
      setSigningIn(false);
    }
  };

  // Handler: Step 2 - Verify Confirmation Code
  const handleVerifyOtp = async (e) => {
    e?.preventDefault?.();
    setErrorMsg('');
    setSuccessMsg('');
    const cleanEmail = email.trim().toLowerCase();
    const cleanToken = otpCode.trim();

    if (!cleanToken) {
      setErrorMsg('Please enter the confirmation code received in your email.');
      return;
    }

    setSigningIn(true);
    try {
      const res = await verifyEmailOtp(cleanEmail, cleanToken);
      if (res.error) {
        throw res.error;
      }

      const verifiedUser = res.data?.user || res.data?.session?.user;
      if (!verifiedUser?.email) {
        throw new Error('Authentication succeeded but user profile was not returned.');
      }

      // Final whitelist check
      const allowed = await verifyEmailAccess(verifiedUser.email);
      if (!allowed) {
        await signOutUser();
        throw new Error(`Access Denied: "${verifiedUser.email}" is not authorized.`);
      }

      setUser(verifiedUser);
      onUserChange?.(verifiedUser);
      try {
        localStorage.setItem('waguri_auth_user', JSON.stringify(verifiedUser));
        localStorage.removeItem('waguri_signed_out');
      } catch {}

      setSuccessMsg(`Welcome to Waguri, ${verifiedUser.email}! ✨`);
      setTimeout(() => {
        setIsAuthModalOpen(false);
        setSuccessMsg('');
        setOtpSent(false);
        setOtpCode('');
      }, 700);
    } catch (err) {
      console.error('[auth] verifyOtp error:', err);
      setErrorMsg(err.message || 'Invalid or expired confirmation code. Please check your email.');
    } finally {
      setSigningIn(false);
    }
  };

  // Handler: Resend OTP
  const handleResendOtp = async () => {
    if (cooldown > 0 || signingIn) return;
    setErrorMsg('');
    setSuccessMsg('');
    const cleanEmail = email.trim().toLowerCase();
    setSigningIn(true);
    try {
      const { error } = await signInWithOtp(cleanEmail);
      if (error) throw error;
      setCooldown(60);
      setSuccessMsg(`Fresh confirmation code sent to ${cleanEmail}!`);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to resend confirmation code.');
    } finally {
      setSigningIn(false);
    }
  };

  // Handler: Google OAuth Sign In
  const handleGoogleSignIn = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    try {
      setSigningIn(true);
      await signInWithGoogle();
    } catch (err) {
      console.error('[auth] Google Sign-In caught error:', err);
      setErrorMsg('Google Sign-In failed. Please try again.');
    } finally {
      setSigningIn(false);
    }
  };

  // Handler: Switch Account
  const handleSwitchAccount = () => {
    setMenuOpen(false);
    setIsAuthModalOpen(true);
    setOtpSent(false);
    setOtpCode('');
    setErrorMsg('');
    setSuccessMsg('');
  };

  // Handler: Sign Out
  const handleSignOut = async () => {
    setSigningIn(true);
    try {
      try {
        localStorage.removeItem('waguri_auth_user');
        localStorage.setItem('waguri_signed_out', '1');
      } catch {}
      await signOutUser();
      setUser(null);
      onUserChange?.(null);
      setMenuOpen(false);
      setIsAuthModalOpen(true);
      setOtpSent(false);
      setOtpCode('');
      setErrorMsg('');
      setSuccessMsg('You have been signed out. Please sign in with your email or Google account.');
    } finally {
      setSigningIn(false);
    }
  };

  // Render Auth Modal Dialog
  const renderAuthModal = () => {
    if (!isAuthModalOpen) return null;

    return (
      <div className="auth-modal-backdrop" onClick={() => setIsAuthModalOpen(false)}>
        <div className="auth-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <button
            type="button"
            className="auth-modal-close"
            onClick={() => setIsAuthModalOpen(false)}
            aria-label="Close sign in dialog"
          >
            <X size={18} />
          </button>

          <div className="auth-modal-header">
            <div className="auth-modal-badge">
              <Sparkles size={15} />
              <span>Full Access Authentication</span>
            </div>
            <h3 className="auth-modal-title">Welcome to Waguri ✨</h3>
            <p className="auth-modal-subtitle">
              Sign in with your <strong>authorized Email</strong> (Confirmation Code / Magic Link) or <strong>Google Account</strong>.
            </p>
          </div>

          {errorMsg && (
            <div className="auth-msg-error">
              <AlertCircle size={15} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px' }} />
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="auth-msg-success">
              <CheckCircle2 size={15} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px' }} />
              {successMsg}
            </div>
          )}

          {!otpSent ? (
            /* Step 1: Email Input Form (Passwordless) */
            <>
              <form onSubmit={handleSendOtp} className="auth-form">
                <div className="auth-input-group">
                  <Mail size={16} className="auth-input-icon" />
                  <input
                    type="email"
                    placeholder="Enter authorized email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="auth-input"
                    required
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  className="auth-primary-btn"
                  disabled={signingIn || !email.trim()}
                >
                  {signingIn ? (
                    <RefreshCw size={16} className="spin-icon" />
                  ) : (
                    <Send size={16} />
                  )}
                  <span>{signingIn ? 'Sending Code...' : 'Send Confirmation Code / Magic Link'}</span>
                </button>
              </form>

              <div className="auth-or-divider">
                <span className="auth-or-line" />
                <span className="auth-or-text">or continue with</span>
                <span className="auth-or-line" />
              </div>

              {/* Google Sign In Button */}
              <div className="auth-google-wrapper">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={signingIn}
                  className="bg-[linear-gradient(#e9e9e9,#e9e9e9_50%,#fff)] group w-50 h-16 inline-flex transition-all duration-300 overflow-visible p-1 rounded-full group google-signin-btn"
                  title="Sign In with Google"
                  aria-label="Sign In with Google"
                >
                  <div className="w-half h-full bg-[linear-gradient(to_top,#ececec,#fff)] overflow-hidden shadow-[0_0_1px_rgba(0,0,0,0.07),0_0_1px_rgba(0,0,0,0.05),0_3px_3px_rgba(0,0,0,0.25),0_1px_3px_rgba(0,0,0,0.12)] p-1 rounded-full hover:shadow-none duration-300 google-btn-middle">
                    <div className="w-full h-full text-xl gap-x-0.5 gap-y-0.5 justify-center text-[#101010] bg-[linear-gradient(#f4f4f4,#fefefe)] group-hover:bg-[linear-gradient(#e2e2e2,#fefefe)] duration-200 items-center text-[18px] font-medium gap-4 inline-flex overflow-hidden px-4 py-2 rounded-full black group-hover:text-blue-600 google-btn-inner">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 64 64"
                        height="28px"
                        width="24px"
                        className="google-svg-icon"
                      >
                        <g fillRule="evenodd" fill="none" strokeWidth="1" stroke="none">
                          <g fillRule="nonzero" transform="translate(3.000000, 2.000000)">
                            <path
                              fill="#4285F4"
                              d="M57.8123233,30.1515267 C57.8123233,27.7263183 57.6155321,25.9565533 57.1896408,24.1212666 L29.4960833,24.1212666 L29.4960833,35.0674653 L45.7515771,35.0674653 C45.4239683,37.7877475 43.6542033,41.8844383 39.7213169,44.6372555 L39.6661883,45.0037254 L48.4223791,51.7870338 L49.0290201,51.8475849 C54.6004021,46.7020943 57.8123233,39.1313952 57.8123233,30.1515267"
                            />
                            <path
                              fill="#34A853"
                              d="M29.4960833,58.9921667 C37.4599129,58.9921667 44.1456164,56.3701671 49.0290201,51.8475849 L39.7213169,44.6372555 C37.2305867,46.3742596 33.887622,47.5868638 29.4960833,47.5868638 C21.6960582,47.5868638 15.0758763,42.4415991 12.7159637,35.3297782 L12.3700541,35.3591501 L3.26524241,42.4054492 L3.14617358,42.736447 C7.9965904,52.3717589 17.959737,58.9921667 29.4960833,58.9921667"
                            />
                            <path
                              fill="#FBBC05"
                              d="M12.7159637,35.3297782 C12.0932812,33.4944915 11.7329116,31.5279353 11.7329116,29.4960833 C11.7329116,27.4640054 12.0932812,25.4976752 12.6832029,23.6623884 L12.6667095,23.2715173 L3.44779955,16.1120237 L3.14617358,16.2554937 C1.14708246,20.2539019 0,24.7439491 0,29.4960833 C0,34.2482175 1.14708246,38.7380388 3.14617358,42.736447 L12.7159637,35.3297782"
                            />
                            <path
                              fill="#EB4335"
                              d="M29.4960833,11.4050769 C35.0347044,11.4050769 38.7707997,13.7975244 40.9011602,15.7968415 L49.2255853,7.66898166 C44.1130815,2.91684746 37.4599129,0 29.4960833,0 C17.959737,0 7.9965904,6.62018183 3.14617358,16.2554937 L12.6832029,23.6623884 C15.0758763,16.5505675 21.6960582,11.4050769 29.4960833,11.4050769"
                            />
                          </g>
                        </g>
                      </svg>
                      <span className="ml-2 font-medium">
                        {signingIn ? 'Connecting...' : 'Sign In with Google'}
                      </span>
                    </div>
                  </div>
                </button>
              </div>

              <div className="auth-modal-footer">
                <p className="auth-modal-hint">
                  🛡️ Whitelist access enforced. No passwords needed — login via secure email confirmation code or Magic Link.
                </p>
              </div>
            </>
          ) : (
            /* Step 2: OTP / Confirmation Code Verification */
            <div className="auth-step-container">
              <div className="auth-envelope-pulse">
                <Mail size={28} color="#d946ef" />
              </div>
              <h4 className="auth-card-title">Check Your Email 📬</h4>
              <p className="auth-card-description">
                We sent a 6-digit confirmation code and Magic Link to{' '}
                <strong className="auth-highlight-email">{email}</strong>
              </p>

              <div className="auth-verify-dual-instructions">
                <div className="auth-verify-method">
                  <span className="method-num">1</span>
                  <span>Enter the <strong>6-digit code</strong> below to sign in instantly.</span>
                </div>
                <div className="auth-verify-divider">— OR —</div>
                <div className="auth-verify-method">
                  <span className="method-num">2</span>
                  <span>Click the <strong>Magic Link</strong> in the email to log in automatically.</span>
                </div>
              </div>

              <form onSubmit={handleVerifyOtp} className="auth-otp-form">
                <div className="auth-otp-input-wrapper">
                  <KeyRound size={18} className="auth-input-icon" />
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={8}
                    placeholder="• • • • • •"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                    className="auth-otp-input"
                    required
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  className="auth-primary-btn"
                  disabled={signingIn || !otpCode.trim()}
                >
                  {signingIn ? (
                    <RefreshCw size={16} className="spin-icon" />
                  ) : (
                    <CheckCircle2 size={16} />
                  )}
                  <span>{signingIn ? 'Verifying...' : 'Verify Code & Sign In'}</span>
                </button>
              </form>

              <div className="auth-verification-footer">
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={handleResendOtp}
                  disabled={cooldown > 0 || signingIn}
                >
                  <RefreshCw size={13} className={signingIn ? 'spin-icon' : ''} />
                  <span>{cooldown > 0 ? `Resend Code (${cooldown}s)` : 'Resend Code'}</span>
                </button>
                <span className="auth-dot-sep">•</span>
                <button
                  type="button"
                  className="auth-link-btn text-muted"
                  onClick={() => {
                    setOtpSent(false);
                    setOtpCode('');
                    setErrorMsg('');
                  }}
                >
                  <span>Change Email</span>
                </button>
              </div>
              <p className="auth-spam-hint">Didn't see the email? Please check your Spam/Junk folder.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Compact Mode (Topbar profile pill and dropdown)
  if (compact) {
    if (!user) {
      return (
        <div className="google-user-container">
          <button
            type="button"
            className="topbar-signin-btn"
            onClick={() => {
              setIsAuthModalOpen(true);
              setOtpSent(false);
              setOtpCode('');
              setErrorMsg('');
              setSuccessMsg('');
            }}
            title="Sign In with Email or Google"
            aria-label="Sign in"
          >
            <User size={15} />
            <span>Sign In</span>
          </button>
          {renderAuthModal()}
        </div>
      );
    }

    const userEmail = user.email || '';
    const isGoogle = user.app_metadata?.provider === 'google' || Boolean(user.user_metadata?.avatar_url);
    const isBypass = user.id === DEFAULT_BYPASS_USER.id || user.app_metadata?.provider === 'bypass';
    const isAdmin = isAdminEmail(userEmail);
    const name = user.user_metadata?.full_name || user.user_metadata?.name || userEmail.split('@')[0] || 'User';
    const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;

    return (
      <div className="google-user-container" ref={menuRef}>
        <button
          type="button"
          className="google-user-pill"
          onClick={() => setMenuOpen((prev) => !prev)}
          title={`Active account: ${userEmail}`}
          aria-label="User profile menu"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} className="google-user-avatar" crossOrigin="anonymous" />
          ) : (
            <div className="google-user-avatar-fallback">
              <User size={13} />
            </div>
          )}
          <span className="google-user-name">{name}</span>
          <CheckCircle2 size={15} className="google-verified-icon" />
        </button>

        {menuOpen && (
          <div className="google-user-dropdown">
            <div className="dropdown-header">
              <div className="dropdown-badge">
                <ShieldCheck size={14} />
                <span>
                  {isAdmin
                    ? 'Admin Access'
                    : isBypass
                    ? 'Admin'
                    : isGoogle
                    ? 'Google Verified'
                    : 'Email Verified'}
                </span>
              </div>
              <p className="dropdown-name">{name}</p>
              <p className="dropdown-email">{userEmail}</p>
            </div>
            <div className="dropdown-divider" />
            <button
              type="button"
              className="dropdown-switch-btn"
              onClick={handleSwitchAccount}
              disabled={signingIn}
            >
              <Users size={15} />
              <span>Switch Account / Sign In</span>
            </button>
            <button
              type="button"
              className="dropdown-signout-btn"
              onClick={handleSignOut}
              disabled={signingIn}
            >
              <LogOut size={15} />
              <span>Sign Out</span>
            </button>
          </div>
        )}

        {renderAuthModal()}
      </div>
    );
  }

  // Full Screen / Panel Mode
  return (
    <div className="auth-step-container">
      {renderAuthModal()}
      <button
        type="button"
        className="auth-primary-btn"
        onClick={() => {
          setIsAuthModalOpen(true);
          setOtpSent(false);
          setOtpCode('');
        }}
      >
        <User size={16} />
        <span>Open Sign In Dialog</span>
      </button>
    </div>
  );
}
