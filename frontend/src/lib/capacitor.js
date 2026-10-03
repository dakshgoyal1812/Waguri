import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { App as CapApp } from '@capacitor/app';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'

export async function initCapacitor(onBackButton) {
  if (!isNative) return;

  try {
    // 1. Status bar customization
    await StatusBar.setStyle({ style: Style.Dark });
    if (platform === 'android') {
      await StatusBar.setBackgroundColor({ color: '#0b0c10' });
    }
  } catch (err) {
    console.warn('[Capacitor] StatusBar init error:', err);
  }

  try {
    // 2. Hide native splash screen smoothly
    await SplashScreen.hide({ fadeOutDuration: 400 });
  } catch (err) {
    console.warn('[Capacitor] SplashScreen init error:', err);
  }

  try {
    // 3. Android hardware back button handler
    if (platform === 'android') {
      CapApp.addListener('backButton', ({ canGoBack }) => {
        if (onBackButton && onBackButton()) {
          // Handled internally by closing panel/modal
          return;
        }
        if (canGoBack) {
          window.history.back();
        } else {
          CapApp.minimizeApp();
        }
      });
    }
  } catch (err) {
    console.warn('[Capacitor] BackButton listener error:', err);
  }
}

export async function triggerHaptic(style = ImpactStyle.Light) {
  if (!isNative) return;
  try {
    await Haptics.impact({ style });
  } catch {
    // ignore
  }
}
