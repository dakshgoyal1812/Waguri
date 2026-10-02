import React, { useState, useEffect, useRef } from 'react';
import {
  LogOut,
  CheckCircle2,
  ShieldCheck,
  User,
  Mail,
  Lock,
  KeyRound,
  RefreshCw,
  ArrowRight,
  Sparkles,
  AlertCircle,
  Eye,
  EyeOff,
  Send,
  HelpCircle,
} from 'lucide-react';
import {
  supabase,
  isSupabaseConfigured,
  isEmailAllowed,
  verifyEmailAccess,
  isAdminEmail,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  signInWithOtp,
  verifyEmailOtp,
  resendVerificationEmail,
  resetPasswordForEmail,
  signOutUser,
} from '../supabaseClient.js';

export default function GoogleAuth({ onUserChange, onLoadingChange, compact = false }) {
  const [user, setUser] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Auth Card States
  // 'signin' | 'signup' | 'otp_login' | 'verify_otp' | 'forgot_password' | 'unauthorized'
  const [step, setStep] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [unauthorizedUser, setUnauthorizedUser] = useState(null);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cooldown countdown for resending verification email
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    // Check if OAuth or email confirmation returned error in URL hash or search params
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    if (hash.includes('error=') || search.includes('error=')) {
      const cleanParams = new URLSearchParams(hash.replace(/^#/, '') || search);
      const desc = cleanParams.get('error_description') || cleanParams.get('error');
      if (desc) {
        console.error('[auth] Redirect error:', desc);
        setErrorMsg(desc.replace(/\+/g, ' '));
        window.history.replaceState(null, '', window.location.pathname);
      }
    }

    // Check initial active session
    supabase.auth
      .getSession()
      .then(async ({ data: { session } }) => {
        if (session?.user) {
          const userEmail = session.user.email;
          const isConfirmed = Boolean(
            session.user.email_confirmed_at || session.user.confirmed_at
          );

          if (!isConfirmed) {
            setPendingEmail(userEmail || '');
            setStep('verify_otp');
            setUser(null);
            onUserChange?.(null);
            onLoadingChange?.(false);
            return;
          }

          const allowed = await verifyEmailAccess(userEmail);
          if (!allowed) {
            setUnauthorizedUser(session.user);
            setStep('unauthorized');
            setUser(null);
            onUserChange?.(null);
          } else {
            setUser(session.user);
            onUserChange?.(session.user);
          }
        } else {
          setUser(null);
          onUserChange?.(null);
        }
        onLoadingChange?.(false);
      })
      .catch((err) => {
        console.warn('[auth] getSession error:', err);
        onLoadingChange?.(false);
      });

    // Supabase Auth listener with email verification & dynamic whitelist validation
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[auth] onAuthStateChange event:', event);

      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
        if (session?.user) {
          const userEmail = session.user.email;
          const isConfirmed = Boolean(
            session.user.email_confirmed_at || session.user.confirmed_at
          );

          if (!isConfirmed) {
            setPendingEmail(userEmail || '');
            setStep('verify_otp');
            setUser(null);
            onUserChange?.(null);
            return;
          }

          const allowed = userEmail ? await verifyEmailAccess(userEmail) : false;

          if (!userEmail || !allowed) {
            setUnauthorizedUser(session.user);
            setStep('unauthorized');
            setUser(null);
            onUserChange?.(null);
            return;
          }

          // Clean URL hash/search if token was processed
          if (
            window.location.hash.includes('access_token') ||
            window.location.search.includes('code=')
          ) {
            window.history.replaceState(null, '', window.location.pathname);
          }

          console.log('[auth] Logged in successfully:', userEmail);
          setUser(session.user);
          onUserChange?.(session.user);
          setErrorMsg('');
          setSuccessMsg('');
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        onUserChange?.(null);
      }
    });

    // Auto-detect when user returns from confirming email in another tab/window
    const handleRecheckSession = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            const isConfirmed = Boolean(
              session.user.email_confirmed_at || session.user.confirmed_at
            );
            if (isConfirmed) {
              const allowed = await verifyEmailAccess(session.user.email);
              if (allowed) {
                setUser(session.user);
                onUserChange?.(session.user);
                setStep('signin');
                setErrorMsg('');
                setSuccessMsg('');
              }
            }
          }
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('focus', handleRecheckSession);
    document.addEventListener('visibilitychange', handleRecheckSession);
    window.addEventListener('storage', handleRecheckSession);

    return () => {
      subscription?.unsubscribe?.();
      window.removeEventListener('focus', handleRecheckSession);
      document.removeEventListener('visibilitychange', handleRecheckSession);
      window.removeEventListener('storage', handleRecheckSession);
    };
  }, [onUserChange, onLoadingChange]);

  // Handler: Email + Password Sign In
  const handleEmailSignIn = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setErrorMsg('Please enter your password.');
      return;
    }

    try {
      setSigningIn(true);
      const { data, error } = await signInWithEmail(cleanEmail, password);
      if (error) {
        if (
          error.message.toLowerCase().includes('email not confirmed') ||
          error.message.toLowerCase().includes('not confirmed')
        ) {
          setPendingEmail(cleanEmail);
          setStep('verify_otp');
          setErrorMsg(
            'Your email is not verified yet. Enter the verification code or check your inbox.'
          );
          setCooldown(45);
          return;
        }
        if (error.message.toLowerCase().includes('invalid login credentials')) {
          setErrorMsg(
            'Invalid login credentials. If you originally signed in with Google, click "Sign In with Google" below, or use "Create Account" to set up a new password.'
          );
          return;
        }
        setErrorMsg(error.message);
        return;
      }

      if (data?.user) {
        const isConfirmed = Boolean(
          data.user.email_confirmed_at || data.user.confirmed_at
        );
        if (!isConfirmed) {
          setPendingEmail(cleanEmail);
          setStep('verify_otp');
          return;
        }

        const allowed = await verifyEmailAccess(data.user.email);
        if (!allowed) {
          setUnauthorizedUser(data.user);
          setStep('unauthorized');
          return;
        }

        setUser(data.user);
        onUserChange?.(data.user);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to sign in.');
    } finally {
      setSigningIn(false);
    }
  };

  // Handler: Email + Password Sign Up (Triggers Brevo SMTP Verification)
  const handleEmailSignUp = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    if (!password || password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    try {
      setSigningIn(true);
      const { data, error } = await signUpWithEmail(cleanEmail, password);
      if (error) {
        setErrorMsg(error.message);
        return;
      }

      // Check if email confirmation is required
      if (data?.user && !data?.session) {
        setPendingEmail(cleanEmail);
        setStep('verify_otp');
        setSuccessMsg(
          `Verification email sent to ${cleanEmail} via Brevo SMTP! Please check your inbox.`
        );
        setCooldown(60);
      } else if (data?.session) {
        // Auto-confirmed by Supabase
        const allowed = await verifyEmailAccess(data.user.email);
        if (!allowed) {
          setUnauthorizedUser(data.user);
          setStep('unauthorized');
        } else {
          setUser(data.user);
          onUserChange?.(data.user);
        }
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to create account.');
    } finally {
      setSigningIn(false);
    }
  };

  // Handler: Magic Link / OTP Email Sign-In (Passwordless via Brevo)
  const handleMagicLink = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    try {
      setSigningIn(true);
      const { error } = await signInWithOtp(cleanEmail);
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      setPendingEmail(cleanEmail);
      setStep('verify_otp');
      setSuccessMsg(
        `One-time code & link sent to ${cleanEmail} via Brevo! Check your inbox.`
      );
      setCooldown(60);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to send one-time code.');
    } finally {
      setSigningIn(false);
    }
  };

  // Handler: Verify 6-digit OTP Code in app
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    const cleanToken = otpToken.trim();
    if (!cleanToken) {
      setErrorMsg('Please enter the verification code.');
      return;
    }

    try {
      setSigningIn(true);
      const res = await verifyEmailOtp(pendingEmail, cleanToken, 'signup');
      if (res.error) {
        setErrorMsg(res.error.message || 'Invalid or expired code. Please try again.');
        return;
      }

      const verifiedUser = res.data?.user;
      if (verifiedUser) {
        const allowed = await verifyEmailAccess(verifiedUser.email);
        if (!allowed) {
          setUnauthorizedUser(verifiedUser);
          setStep('unauthorized');
          return;
        }

        setUser(verifiedUser);
        onUserChange?.(verifiedUser);
        setSuccessMsg('Email verified successfully!');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Verification failed. Try clicking the link in your email instead.');
    } finally {
      setSigningIn(false);
    }
  };

  // Handler: Resend verification email via Brevo
  const handleResendVerification = async () => {
    if (cooldown > 0 || !pendingEmail) return;
    setErrorMsg('');
    setSuccessMsg('');
    try {
      setSigningIn(true);
      const { error } = await resendVerificationEmail(pendingEmail);
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      setSuccessMsg(`A new verification email has been dispatched to ${pendingEmail} via Brevo SMTP!`);
      setCooldown(60);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to resend email.');
    } finally {
      setSigningIn(false);
    }
  };

  // Handler: Forgot password reset link
  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Please enter your email to receive a password reset link.');
      return;
    }

    try {
      setSigningIn(true);
      const { error } = await resetPasswordForEmail(cleanEmail);
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      setSuccessMsg(`Password reset link sent to ${cleanEmail} via Brevo!`);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to send reset link.');
    } finally {
      setSigningIn(false);
    }
  };

  // Handler: Google OAuth
  const handleGoogleSignIn = async () => {
    setErrorMsg('');
    try {
      setSigningIn(true);
      await signInWithGoogle();
    } catch (err) {
      console.error('Google Sign-In caught error:', err);
      setErrorMsg('Google Sign-In failed.');
    } finally {
      setSigningIn(false);
    }
  };

  // Handler: Sign out
  const handleSignOut = async () => {
    setSigningIn(true);
    try {
      await signOutUser();
      setUser(null);
      setUnauthorizedUser(null);
      setStep('signin');
      onUserChange?.(null);
      setMenuOpen(false);
    } finally {
      setSigningIn(false);
    }
  };

  // ============================================================
  // Topbar Compact Mode (for logged in user)
  // ============================================================
  if (compact) {
    if (!user) return null;

    const userEmail = user.email || '';
    const isGoogle = user.app_metadata?.provider === 'google' || user.user_metadata?.avatar_url;
    const name = user.user_metadata?.full_name || user.user_metadata?.name || userEmail.split('@')[0];
    const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;

    return (
      <div className="google-user-container" ref={menuRef}>
        <button
          type="button"
          className="google-user-pill"
          onClick={() => setMenuOpen((prev) => !prev)}
          title={`Verified: ${userEmail}`}
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
                <span>{isGoogle ? 'Google Verified' : 'Brevo Email Verified'}</span>
              </div>
              <p className="dropdown-name">{name}</p>
              <p className="dropdown-email">{userEmail}</p>
            </div>
            <div className="dropdown-divider" />
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
      </div>
    );
  }

  // ============================================================
  // Full Auth Gate Interface
  // ============================================================

  // State: Unauthorized / Whitelist Gate
  if (step === 'unauthorized') {
    const pendingWhitelistedEmail = unauthorizedUser?.email || email || 'your email';
    return (
      <div className="auth-step-container">
        <div className="auth-unauth-badge">
          <AlertCircle size={28} className="text-amber-500" />
        </div>
        <h3 className="auth-card-title">Email Verified ✨</h3>
        <p className="auth-card-description">
          Your email <strong>{pendingWhitelistedEmail}</strong> is verified, but Waguri is currently in <strong>private access mode</strong>.
        </p>
        <div className="auth-info-box">
          <p>
            An administrator must add your email to the whitelist before you can enter.
          </p>
          <div className="auth-admin-contact">
            <span>Primary Admin:</span> <code>dakshgoyal1812@gmail.com</code>
          </div>
        </div>
        <div className="auth-actions-row">
          <button
            type="button"
            className="auth-btn-secondary"
            onClick={async () => {
              setSigningIn(true);
              const allowed = await verifyEmailAccess(pendingWhitelistedEmail);
              setSigningIn(false);
              if (allowed) {
                setUser(unauthorizedUser);
                onUserChange?.(unauthorizedUser);
                setStep('signin');
              } else {
                setErrorMsg('Your account is still pending approval.');
              }
            }}
            disabled={signingIn}
          >
            <RefreshCw size={14} className={signingIn ? 'spin-icon' : ''} />
            <span>Re-check Whitelist</span>
          </button>
          <button
            type="button"
            className="auth-btn-outline"
            onClick={handleSignOut}
          >
            <LogOut size={14} />
            <span>Switch Account</span>
          </button>
        </div>
        {errorMsg && <div className="auth-msg-error">{errorMsg}</div>}
      </div>
    );
  }

  // State: Email Verification Pending (Brevo SMTP dispatched)
  if (step === 'verify_otp') {
    return (
      <div className="auth-step-container">
        <div className="auth-envelope-pulse">
          <Mail size={32} className="text-pink-500" />
        </div>
        <div className="auth-brevo-tag">
          <Sparkles size={13} />
          <span>Brevo SMTP Active</span>
        </div>
        <h3 className="auth-card-title">Check Your Inbox 📬</h3>
        <p className="auth-card-description">
          We sent a verification email to:
          <br />
          <strong className="auth-highlight-email">{pendingEmail || email}</strong>
        </p>

        <div className="auth-verify-dual-instructions">
          <div className="auth-verify-method">
            <span className="method-num">1</span>
            <span>Click the <strong>Confirmation Link</strong> in the email sent by Brevo.</span>
          </div>
          <div className="auth-verify-divider">OR</div>
          <div className="auth-verify-method">
            <span className="method-num">2</span>
            <span>Enter the <strong>6-digit Code</strong> from the email below:</span>
          </div>
        </div>

        <form onSubmit={handleVerifyOtp} className="auth-otp-form">
          <div className="auth-otp-input-wrapper">
            <KeyRound size={18} className="auth-input-icon" />
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={otpToken}
              onChange={(e) => setOtpToken(e.target.value.trim())}
              placeholder="Enter 6-digit code"
              className="auth-otp-input"
              autoFocus
            />
          </div>

          <button
            type="submit"
            className="auth-primary-btn"
            disabled={signingIn || !otpToken.trim()}
          >
            {signingIn ? (
              <RefreshCw size={16} className="spin-icon" />
            ) : (
              <CheckCircle2 size={16} />
            )}
            <span>Verify & Enter Waguri</span>
          </button>
        </form>

        {errorMsg && <div className="auth-msg-error">{errorMsg}</div>}
        {successMsg && <div className="auth-msg-success">{successMsg}</div>}

        <div className="auth-verification-footer">
          <button
            type="button"
            className="auth-link-btn"
            onClick={handleResendVerification}
            disabled={cooldown > 0 || signingIn}
          >
            <Send size={13} />
            <span>
              {cooldown > 0 ? `Resend email in ${cooldown}s` : 'Resend verification email'}
            </span>
          </button>
          <span className="auth-dot-sep">•</span>
          <button
            type="button"
            className="auth-link-btn text-muted"
            onClick={() => {
              setStep('signin');
              setErrorMsg('');
              setSuccessMsg('');
            }}
          >
            Use different email
          </button>
        </div>

        <p className="auth-spam-hint">
          💡 If you don't see it within a minute, please check your <strong>Spam / Junk</strong> folder.
        </p>
      </div>
    );
  }

  // State: Forgot Password
  if (step === 'forgot_password') {
    return (
      <div className="auth-step-container">
        <h3 className="auth-card-title">Reset Password</h3>
        <p className="auth-card-description">
          Enter your email and we will send you a password reset link via Brevo SMTP.
        </p>
        <form onSubmit={handleForgotPassword} className="auth-form">
          <div className="auth-input-group">
            <Mail size={16} className="auth-input-icon" />
            <input
              type="email"
              placeholder="Your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="auth-input"
              required
              autoFocus
            />
          </div>
          <button type="submit" className="auth-primary-btn" disabled={signingIn}>
            {signingIn ? <RefreshCw size={16} className="spin-icon" /> : <Send size={16} />}
            <span>Send Reset Link</span>
          </button>
        </form>
        {errorMsg && <div className="auth-msg-error">{errorMsg}</div>}
        {successMsg && <div className="auth-msg-success">{successMsg}</div>}
        <button
          type="button"
          className="auth-link-btn back-btn"
          onClick={() => {
            setStep('signin');
            setErrorMsg('');
            setSuccessMsg('');
          }}
        >
          ← Back to Sign In
        </button>
      </div>
    );
  }

  // ============================================================
  // Main Login / Sign Up Tabs View
  // ============================================================
  return (
    <div className="auth-interactive-panel">
      {/* Brevo Delivery Assurance Badge */}
      <div className="auth-brevo-pill" title="Email verification powered by Brevo SMTP">
        <Sparkles size={12} className="brevo-sparkle-icon" />
        <span>Secured via <strong>Brevo SMTP</strong></span>
      </div>

      {/* Tabs */}
      <div className="auth-tabs-header">
        <button
          type="button"
          className={`auth-tab-btn ${step === 'signin' ? 'active' : ''}`}
          onClick={() => {
            setStep('signin');
            setErrorMsg('');
            setSuccessMsg('');
          }}
        >
          Sign In
        </button>
        <button
          type="button"
          className={`auth-tab-btn ${step === 'signup' ? 'active' : ''}`}
          onClick={() => {
            setStep('signup');
            setErrorMsg('');
            setSuccessMsg('');
          }}
        >
          Create Account
        </button>
        <button
          type="button"
          className={`auth-tab-btn ${step === 'otp_login' ? 'active' : ''}`}
          onClick={() => {
            setStep('otp_login');
            setErrorMsg('');
            setSuccessMsg('');
          }}
        >
          Magic Code
        </button>
      </div>

      {/* Error & Success Messages */}
      {errorMsg && <div className="auth-msg-error">{errorMsg}</div>}
      {successMsg && <div className="auth-msg-success">{successMsg}</div>}

      {/* TAB 1: Sign In with Email & Password */}
      {step === 'signin' && (
        <form onSubmit={handleEmailSignIn} className="auth-form">
          <div className="auth-input-group">
            <Mail size={16} className="auth-input-icon" />
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="auth-input"
              required
            />
          </div>

          <div className="auth-input-group">
            <Lock size={16} className="auth-input-icon" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="auth-input"
              required
            />
            <button
              type="button"
              className="auth-input-toggle-pwd"
              onClick={() => setShowPassword((prev) => !prev)}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          <div className="auth-forgot-row">
            <button
              type="button"
              className="auth-link-forgot"
              onClick={() => {
                setStep('forgot_password');
                setErrorMsg('');
                setSuccessMsg('');
              }}
            >
              Forgot password?
            </button>
          </div>

          <button type="submit" className="auth-primary-btn" disabled={signingIn}>
            {signingIn ? <RefreshCw size={16} className="spin-icon" /> : <ArrowRight size={16} />}
            <span>Sign In</span>
          </button>
        </form>
      )}

      {/* TAB 2: Create Account with Email (Brevo Verification) */}
      {step === 'signup' && (
        <form onSubmit={handleEmailSignUp} className="auth-form">
          <div className="auth-tab-intro">
            <span>✨ Brevo will send a verification link to confirm your inbox.</span>
          </div>

          <div className="auth-input-group">
            <Mail size={16} className="auth-input-icon" />
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="auth-input"
              required
            />
          </div>

          <div className="auth-input-group">
            <Lock size={16} className="auth-input-icon" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Create password (min 6 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="auth-input"
              minLength={6}
              required
            />
            <button
              type="button"
              className="auth-input-toggle-pwd"
              onClick={() => setShowPassword((prev) => !prev)}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          <button type="submit" className="auth-primary-btn" disabled={signingIn}>
            {signingIn ? <RefreshCw size={16} className="spin-icon" /> : <Mail size={16} />}
            <span>Create Account & Verify</span>
          </button>
        </form>
      )}

      {/* TAB 3: Magic Code / Link (Passwordless via Brevo) */}
      {step === 'otp_login' && (
        <form onSubmit={handleMagicLink} className="auth-form">
          <div className="auth-tab-intro">
            <span>🔑 Sign in password-free. We'll email you a one-time code or link.</span>
          </div>

          <div className="auth-input-group">
            <Mail size={16} className="auth-input-icon" />
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="auth-input"
              required
            />
          </div>

          <button type="submit" className="auth-primary-btn" disabled={signingIn}>
            {signingIn ? <RefreshCw size={16} className="spin-icon" /> : <Send size={16} />}
            <span>Send One-Time Code / Link</span>
          </button>
        </form>
      )}

      {/* Divider */}
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
          <div
            className="w-half h-full bg-[linear-gradient(to_top,#ececec,#fff)] overflow-hidden shadow-[0_0_1px_rgba(0,0,0,0.07),0_0_1px_rgba(0,0,0,0.05),0_3px_3px_rgba(0,0,0,0.25),0_1px_3px_rgba(0,0,0,0.12)] p-1 rounded-full hover:shadow-none duration-300 google-btn-middle"
          >
            <div
              className="w-full h-full text-xl gap-x-0.5 gap-y-0.5 justify-center text-[#101010] bg-[linear-gradient(#f4f4f4,#fefefe)] group-hover:bg-[linear-gradient(#e2e2e2,#fefefe)] duration-200 items-center text-[18px] font-medium gap-4 inline-flex overflow-hidden px-4 py-2 rounded-full black group-hover:text-blue-600 google-btn-inner"
            >
              <svg
                xmlnsXlink="http://www.w3.org/1999/xlink"
                xmlns="http://www.w3.org/2000/svg"
                version="1.1"
                viewBox="0 0 64 64"
                height="32px"
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
    </div>
  );
}
