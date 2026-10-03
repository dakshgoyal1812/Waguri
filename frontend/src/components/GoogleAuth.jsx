import React, { useState, useEffect, useRef } from 'react';
import {
  LogOut,
  CheckCircle2,
  ShieldCheck,
  User,
  Mail,
  Lock,
  RefreshCw,
  ArrowRight,
  Sparkles,
  AlertCircle,
  Eye,
  EyeOff,
  X,
  Users,
} from 'lucide-react';
import {
  supabase,
  isSupabaseConfigured,
  verifyEmailAccess,
  isAdminEmail,
  signInWithGoogle,
  signInWithEmail,
  signOutUser,
  DEFAULT_BYPASS_USER,
} from '../supabaseClient.js';

export { DEFAULT_BYPASS_USER };

export default function GoogleAuth({ onUserChange, onLoadingChange, compact = false }) {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('waguri_auth_user');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.email) return parsed;
      }
    } catch {}
    return null;
  });
  const [signingIn, setSigningIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const menuRef = useRef(null);

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

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

  // Check initial active session (Google OAuth or stored whitelisted Email session)
  useEffect(() => {
    let isMounted = true;

    const restoreSession = async () => {
      // 1. Check Supabase OAuth session
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email) {
          const clean = session.user.email.trim().toLowerCase();
          const isGoogleUser =
            session.user.app_metadata?.provider === 'google' ||
            Boolean(session.user.user_metadata?.avatar_url) ||
            Boolean(session.user.identities?.some((i) => i.provider === 'google'));

          // Google accounts are authenticated via Google OAuth; email accounts check whitelist
          const allowed = isGoogleUser || (await verifyEmailAccess(clean));
          if (allowed && isMounted) {
            setUser(session.user);
            onUserChange?.(session.user);
            try {
              localStorage.setItem('waguri_auth_user', JSON.stringify(session.user));
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
        const raw = localStorage.getItem('waguri_auth_user');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.email) {
            const clean = parsed.email.trim().toLowerCase();
            const isGoogleUser =
              parsed.app_metadata?.provider === 'google' ||
              Boolean(parsed.user_metadata?.avatar_url);

            const allowed = isGoogleUser || (await verifyEmailAccess(clean));
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

      // 3. Fallback: No active session -> remain signed out
      if (isMounted) {
        setUser(null);
        onUserChange?.(null);
        onLoadingChange?.(false);
      }
    };

    restoreSession();

    // Supabase Auth listener for OAuth redirects
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
        if (session?.user?.email) {
          const clean = session.user.email.trim().toLowerCase();
          const isGoogleUser =
            session.user.app_metadata?.provider === 'google' ||
            Boolean(session.user.user_metadata?.avatar_url) ||
            Boolean(session.user.identities?.some((i) => i.provider === 'google'));

          const allowed = isGoogleUser || (await verifyEmailAccess(clean));
          if (allowed) {
            setUser(session.user);
            onUserChange?.(session.user);
            try { localStorage.setItem('waguri_auth_user', JSON.stringify(session.user)); } catch {}
            setErrorMsg('');
            setSuccessMsg('');
            setIsAuthModalOpen(false);

            // Clean OAuth code or hash tokens from browser address bar
            if (typeof window !== 'undefined' && (window.location.hash || window.location.search.includes('code='))) {
              window.history.replaceState({}, document.title, window.location.pathname);
            }
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
        const stored = localStorage.getItem('waguri_auth_user');
        if (!stored) {
          setUser(null);
          onUserChange?.(null);
        }
      }
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe?.();
    };
  }, [onUserChange, onLoadingChange]);

  // Handler: Email Sign In (Whitelisted Email or Supabase Account)
  const handleEmailLogin = async (e) => {
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
      // If user provided a password, try Supabase password login first
      if (password && password.trim()) {
        try {
          const { data, error } = await signInWithEmail(cleanEmail, password);
          if (!error && data?.user) {
            const allowed = await verifyEmailAccess(data.user.email);
            if (allowed) {
              setUser(data.user);
              onUserChange?.(data.user);
              try { localStorage.setItem('waguri_auth_user', JSON.stringify(data.user)); } catch {}
              setSuccessMsg(`Welcome, ${data.user.email}!`);
              setTimeout(() => {
                setIsAuthModalOpen(false);
                setSuccessMsg('');
              }, 600);
              return;
            }
          }
        } catch (pwdErr) {
          console.warn('[auth] Supabase password signin skipped/failed:', pwdErr?.message);
        }
      }

      // Direct Whitelisted Email Sign In (Admin-granted access)
      const allowed = await verifyEmailAccess(cleanEmail);

      if (!allowed) {
        setErrorMsg(
          `Access Denied: "${cleanEmail}" is not on the whitelist. Please ask an admin to add your email in the Admin Portal.`
        );
        return;
      }

      // Create verified user session
      const verifiedUser = {
        id: `email_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`,
        email: cleanEmail,
        user_metadata: {
          full_name: cleanEmail.split('@')[0],
          name: cleanEmail.split('@')[0],
          email: cleanEmail,
        },
        app_metadata: {
          provider: 'email',
          whitelisted: true,
        },
        email_confirmed_at: new Date().toISOString(),
      };

      try {
        localStorage.setItem('waguri_auth_user', JSON.stringify(verifiedUser));
      } catch {}

      setUser(verifiedUser);
      onUserChange?.(verifiedUser);
      setSuccessMsg(`Access Granted! Welcome to Waguri, ${cleanEmail}.`);
      setTimeout(() => {
        setIsAuthModalOpen(false);
        setSuccessMsg('');
        setEmail('');
        setPassword('');
      }, 700);
    } catch (err) {
      console.error('[auth] Email login error:', err);
      setErrorMsg(err.message || 'Failed to authenticate email.');
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
    setErrorMsg('');
    setSuccessMsg('');
  };

  // Handler: Sign Out
  const handleSignOut = async () => {
    setSigningIn(true);
    try {
      try { localStorage.removeItem('waguri_auth_user'); } catch {}
      await signOutUser();
      setUser(null);
      onUserChange?.(null);
      setMenuOpen(false);
      setIsAuthModalOpen(true);
      setErrorMsg('');
      setSuccessMsg('You have been signed out. Please sign in with any authorized email or Google account.');
    } finally {
      setSigningIn(false);
    }
  };

  // Form body component reused in both Full Screen Auth Gate and Modal Dialog
  const renderFormBody = () => (
    <div className="auth-interactive-panel">
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

      {/* Google Sign In Button - Primary Option */}
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

      <div className="auth-or-divider">
        <span className="auth-or-line" />
        <span className="auth-or-text">or continue with email</span>
        <span className="auth-or-line" />
      </div>

      {/* Email Sign In Form */}
      <form onSubmit={handleEmailLogin} className="auth-form">
        <div className="auth-input-group">
          <Mail size={16} className="auth-input-icon" />
          <input
            type="email"
            placeholder="Enter authorized email address"
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
            placeholder="Password (optional for whitelisted emails)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="auth-input"
          />
          <button
            type="button"
            className="auth-input-toggle-pwd"
            onClick={() => setShowPassword((prev) => !prev)}
            tabIndex={-1}
            title={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        <button
          type="submit"
          className="auth-primary-btn"
          disabled={signingIn || !email.trim()}
        >
          {signingIn ? (
            <RefreshCw size={16} className="spin-icon" />
          ) : (
            <ArrowRight size={16} />
          )}
          <span>{signingIn ? 'Verifying...' : 'Sign In with Email'}</span>
        </button>
      </form>
    </div>
  );

  // Render Auth Modal Dialog (for topbar compact popup)
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
              Sign in with your <strong>Google Account</strong> or <strong>Email</strong> to get full access.
            </p>
          </div>

          {renderFormBody()}

          <div className="auth-modal-footer">
            <p className="auth-modal-hint">
              🛡️ Whitelist access enforced. Need access? Contact <code>dakshgoyal1812@gmail.com</code>.
            </p>
          </div>
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
                    ? 'Admin (Bypassed)'
                    : isGoogle
                    ? 'Google Verified'
                    : 'Email Whitelisted'}
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

  // Full Screen / Auth Gate Mode (compact = false)
  return renderFormBody();
}
