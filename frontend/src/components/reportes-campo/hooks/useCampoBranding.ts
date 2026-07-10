import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogoData, ReportType } from '../types';
import {
    brandingToStored,
    loadBranding,
    saveBranding,
    storedToBrandingLogos,
} from '../utils/storage';

const SAVE_DEBOUNCE_MS = 400;

function revokeLogo(logo: LogoData | null) {
    if (logo) URL.revokeObjectURL(logo.url);
}

export function useCampoBranding(reportType: ReportType) {
    const [logoLeft, setLogoLeft] = useState<LogoData | null>(null);
    const [logoRight, setLogoRight] = useState<LogoData | null>(null);

    const logoLeftRef = useRef(logoLeft);
    const logoRightRef = useRef(logoRight);
    logoLeftRef.current = logoLeft;
    logoRightRef.current = logoRight;

    const reportTypeRef = useRef(reportType);
    reportTypeRef.current = reportType;

    const loadedTypeRef = useRef<ReportType | null>(null);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dirtyRef = useRef(false);

    const persistNow = useCallback((type: ReportType, left: LogoData | null, right: LogoData | null) => {
        dirtyRef.current = false;
        void saveBranding(brandingToStored(type, left, right));
    }, []);

    const flushPendingSave = useCallback((type: ReportType = reportTypeRef.current) => {
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        if (!dirtyRef.current) return;
        persistNow(type, logoLeftRef.current, logoRightRef.current);
    }, [persistNow]);

    const scheduleSave = useCallback(() => {
        dirtyRef.current = true;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            persistNow(reportTypeRef.current, logoLeftRef.current, logoRightRef.current);
        }, SAVE_DEBOUNCE_MS);
    }, [persistNow]);

    // Load branding per plantilla; flush previous type before swap.
    useEffect(() => {
        const type = reportType;
        const prev = loadedTypeRef.current;

        if (prev === type) return;

        if (prev !== null) {
            flushPendingSave(prev);
            revokeLogo(logoLeftRef.current);
            revokeLogo(logoRightRef.current);
            logoLeftRef.current = null;
            logoRightRef.current = null;
            setLogoLeft(null);
            setLogoRight(null);
        }
        loadedTypeRef.current = type;

        let cancelled = false;
        void (async () => {
            const stored = await loadBranding(type);
            if (cancelled) return;
            const logos = storedToBrandingLogos(stored);
            setLogoLeft(logos.logoLeft);
            setLogoRight(logos.logoRight);
        })();

        return () => {
            cancelled = true;
        };
    }, [reportType, flushPendingSave]);

    useEffect(() => {
        return () => {
            flushPendingSave();
        };
    }, [flushPendingSave]);

    const setLogo = useCallback((side: 'left' | 'right', files: FileList | null) => {
        if (!files?.[0]) return;
        const file = files[0];
        const url = URL.createObjectURL(file);
        const next: LogoData = { file, url };
        if (side === 'left') {
            revokeLogo(logoLeftRef.current);
            logoLeftRef.current = next;
            setLogoLeft(next);
        } else {
            revokeLogo(logoRightRef.current);
            logoRightRef.current = next;
            setLogoRight(next);
        }
        scheduleSave();
    }, [scheduleSave]);

    const removeLogo = useCallback((side: 'left' | 'right') => {
        if (side === 'left') {
            revokeLogo(logoLeftRef.current);
            logoLeftRef.current = null;
            setLogoLeft(null);
        } else {
            revokeLogo(logoRightRef.current);
            logoRightRef.current = null;
            setLogoRight(null);
        }
        scheduleSave();
    }, [scheduleSave]);

    return {
        logoLeft,
        logoRight,
        setLogo,
        removeLogo,
    };
}
