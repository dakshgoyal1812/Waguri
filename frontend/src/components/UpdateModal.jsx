import React, { useState, useEffect } from 'react';
import { Download, Sparkles, X, RefreshCw, CheckCircle2, AlertCircle, ArrowUpCircle } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

export const CURRENT_APP_VERSION = '1.0.3';
const GITHUB_REPO = 'dakshgoyal1812/Waguri';

// Compare semantic versions (returns true if remote is strictly newer than current)
export function compareVersions(remoteVer, currentVer) {
  const parse = (v) => (v || '').replace(/^[^\d]*/, '').replace(/-.*$/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const r = parse(remoteVer);
  const c = parse(currentVer);
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const rNum = r[i] || 0;
    const cNum = c[i] || 0;
    if (rNum > cNum) return true;
    if (rNum < cNum) return false;
  }
  return false;
}

export async function checkLatestRelease() {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) throw new Error(`GitHub API returned status ${res.status}`);
    const data = await res.json();
    const latestTag = data.tag_name || '';
    const isNewer = compareVersions(latestTag, CURRENT_APP_VERSION);
    
    // Find Waguri.apk asset
    const apkAsset = (data.assets || []).find((a) => a.name.endsWith('.apk'));
    const apkUrl = apkAsset?.browser_download_url || `https://github.com/${GITHUB_REPO}/releases/download/${latestTag}/Waguri.apk`;

    return {
      hasUpdate: isNewer,
      latestVersion: latestTag.replace(/^v/, '').replace(/-apk$/, ''),
      currentVersion: CURRENT_APP_VERSION,
      releaseName: data.name || latestTag,
      releaseNotes: data.body || '',
      apkUrl,
      publishedAt: data.published_at,
    };
  } catch (err) {
    console.warn('[updater] Failed to check for updates:', err?.message);
    return null;
  }
}

export default function UpdateModal({ isOpen, onClose, updateData, onDismiss }) {
  const [downloading, setDownloading] = useState(false);

  if (!isOpen || !updateData) return null;

  const handleUpdate = async () => {
    setDownloading(true);
    try {
      const url = updateData.apkUrl;
      if (Capacitor.isNativePlatform()) {
        try {
          await Browser.open({ url, windowName: '_system' });
        } catch {
          window.open(url, '_system');
        }
      } else {
        window.open(url, '_blank');
      }
    } catch (err) {
      console.error('[updater] Failed to open download link:', err);
    } finally {
      setDownloading(false);
      if (onClose) onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md bg-gradient-to-b from-[#1c1b29] to-[#12111d] border border-pink-500/30 rounded-3xl shadow-2xl p-6 text-white overflow-hidden">
        {/* Glow background accent */}
        <div className="absolute -top-12 -right-12 w-36 h-36 bg-pink-500/20 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-12 -left-12 w-36 h-36 bg-purple-500/20 rounded-full blur-2xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/50 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-500 to-purple-500 flex items-center justify-center shadow-lg shadow-pink-500/30">
            <ArrowUpCircle className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight bg-gradient-to-r from-pink-300 via-purple-200 to-indigo-200 bg-clip-text text-transparent">
              Update Available! ✨
            </h3>
            <p className="text-xs text-white/60">
              Current: <span className="font-mono text-white/80">v{updateData.currentVersion}</span> → New: <span className="font-mono text-pink-400 font-semibold">v{updateData.latestVersion}</span>
            </p>
          </div>
        </div>

        {/* Release Notes Card */}
        <div className="my-4 bg-white/5 border border-white/10 rounded-2xl p-4 max-h-48 overflow-y-auto custom-scrollbar text-xs leading-relaxed text-white/80">
          <div className="font-semibold text-pink-300 mb-1 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-pink-400" />
            What's New in {updateData.releaseName}:
          </div>
          <div className="whitespace-pre-line text-white/70">
            {updateData.releaseNotes || 'Bug fixes, performance improvements, and latest avatar updates.'}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2.5 mt-6">
          <button
            onClick={handleUpdate}
            disabled={downloading}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-pink-500 via-purple-600 to-indigo-600 text-white font-semibold text-sm shadow-lg shadow-pink-500/30 hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            {downloading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Starting Download...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Update Now (Download APK)
              </>
            )}
          </button>

          <button
            onClick={onClose}
            className="w-full py-2.5 px-4 rounded-xl text-xs text-white/60 hover:text-white hover:bg-white/5 transition-colors text-center"
          >
            Remind Me Later
          </button>
        </div>
      </div>
    </div>
  );
}
