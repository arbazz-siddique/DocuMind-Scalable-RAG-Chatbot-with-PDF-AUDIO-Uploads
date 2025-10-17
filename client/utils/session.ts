// utils/session.ts

/**
 * Ultimate Session ID Manager with cross-device compatibility
 * Features:
 * - Multi-storage fallback (localStorage → sessionStorage → memory)
 * - Cross-tab synchronization
 * - Device fingerprinting as fallback
 * - Storage validation and recovery
 * - Mobile browser compatibility
 */

// Memory fallback for when storage is completely unavailable
let memorySessionId: string | null = null;

// Storage keys
const SESSION_KEYS = {
  PRIMARY: 'pdfrag_session_id',
  BACKUP: 'pdfrag_session_backup',
  TIMESTAMP: 'pdfrag_session_ts'
} as const;

// Device fingerprint components (non-PII)
const getDeviceFingerprint = (): string => {
  if (typeof window === 'undefined') return 'server-default';
  
  const components = [
    'language' in navigator ? navigator.language : 'en',
    'hardwareConcurrency' in navigator ? navigator.hardwareConcurrency : 0,
    'platform' in navigator ? navigator.platform : 'unknown',
    'userAgent' in navigator ? navigator.userAgent.length.toString() : '0',
    'deviceMemory' in navigator ? (navigator as any).deviceMemory || 0 : 0,
  ];
  
  return components.join('|');
};

// Enhanced UUID generator with fallbacks
const generateUUID = (): string => {
  try {
    // Primary: Web Crypto API (most secure)
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    
    // Secondary: Crypto getRandomValues
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const buffer = new Uint8Array(16);
      crypto.getRandomValues(buffer);
      buffer[6] = (buffer[6] & 0x0f) | 0x40; // Version 4
      buffer[8] = (buffer[8] & 0x3f) | 0x80; // Variant 10
      
      return Array.from(buffer)
        .map((b, i) => {
          const hex = b.toString(16).padStart(2, '0');
          return hex + ([4, 6, 8, 10].includes(i) ? '-' : '');
        })
        .join('')
        .slice(0, 36);
    }
    
    // Tertiary: Timestamp-based with random component
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    const fingerprint = getDeviceFingerprint();
    const fingerprintHash = Array.from(fingerprint)
      .reduce((acc, char) => acc + char.charCodeAt(0), 0)
      .toString(36);
    
    return `sess-${timestamp}-${random}-${fingerprintHash}`.slice(0, 50);
  } catch (error) {
    // Final fallback
    return `fallback-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
};

// Storage validation and recovery
const validateStorage = (storage: Storage): boolean => {
  try {
    const testKey = 'pdfrag_storage_test';
    const testValue = 'test-' + Date.now();
    
    storage.setItem(testKey, testValue);
    const retrieved = storage.getItem(testKey);
    storage.removeItem(testKey);
    
    return retrieved === testValue;
  } catch {
    return false;
  }
};

// Get available storage with fallbacks
const getAvailableStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  
  try {
    // Primary: localStorage
    if (typeof localStorage !== 'undefined' && validateStorage(localStorage)) {
      return localStorage;
    }
    
    // Secondary: sessionStorage
    if (typeof sessionStorage !== 'undefined' && validateStorage(sessionStorage)) {
      return sessionStorage;
    }
    
    return null;
  } catch {
    return null;
  }
};

// Cross-tab synchronization
const setupSessionSync = (sessionId: string): void => {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  
  try {
    const channel = new BroadcastChannel('pdfrag_session_sync');
    
    channel.addEventListener('message', (event) => {
      if (event.data.type === 'SESSION_UPDATE') {
        const storage = getAvailableStorage();
        if (storage) {
          storage.setItem(SESSION_KEYS.PRIMARY, event.data.sessionId);
          storage.setItem(SESSION_KEYS.TIMESTAMP, Date.now().toString());
        }
        memorySessionId = event.data.sessionId;
      }
    });
    
    // Notify other tabs of session creation/update
    channel.postMessage({
      type: 'SESSION_UPDATE',
      sessionId,
      timestamp: Date.now()
    });
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      channel.close();
    });
  } catch (error) {
    // BroadcastChannel not available, silent fail
  }
};

// Main session ID function
export function getSessionId(): string {
  if (typeof window === 'undefined') return 'server-default';
  
  // Try to get from memory first (fastest)
  if (memorySessionId) {
    return memorySessionId;
  }
  
  const storage = getAvailableStorage();
  let sessionId: string | null = null;
  
  // Strategy 1: Get from storage
  if (storage) {
    try {
      sessionId = storage.getItem(SESSION_KEYS.PRIMARY);
      
      // Validate session ID format and age
      if (sessionId) {
        const timestamp = storage.getItem(SESSION_KEYS.TIMESTAMP);
        const sessionAge = timestamp ? Date.now() - parseInt(timestamp) : Infinity;
        
        // Regenerate if session is too old (30 days) or malformed
        const isMalformed = !sessionId || sessionId.length < 10;
        const isExpired = sessionAge > 30 * 24 * 60 * 60 * 1000; // 30 days
        
        if (isMalformed || isExpired) {
          sessionId = null;
          storage.removeItem(SESSION_KEYS.PRIMARY);
          storage.removeItem(SESSION_KEYS.TIMESTAMP);
        }
      }
    } catch (error) {
      console.warn('Storage access failed, falling back:', error);
      sessionId = null;
    }
  }
  
  // Strategy 2: Generate new session ID
  if (!sessionId) {
    sessionId = generateUUID();
    
    // Save to available storage
    if (storage) {
      try {
        storage.setItem(SESSION_KEYS.PRIMARY, sessionId);
        storage.setItem(SESSION_KEYS.TIMESTAMP, Date.now().toString());
        
        // Backup in secondary storage
        if (storage === localStorage && typeof sessionStorage !== 'undefined') {
          try {
            sessionStorage.setItem(SESSION_KEYS.BACKUP, sessionId);
          } catch {
            // Ignore backup failures
          }
        }
      } catch (error) {
        console.warn('Failed to save session ID to storage:', error);
      }
    }
    
    // Setup cross-tab synchronization
    setupSessionSync(sessionId);
  }
  
  // Update memory cache
  memorySessionId = sessionId;
  
  return sessionId;
}

// Utility functions for session management
export const sessionManager = {
  // Get current session ID
  getSessionId,
  
  // Refresh session (generate new ID)
  refreshSession: (): string => {
    if (typeof window === 'undefined') return 'server-default';
    
    const storage = getAvailableStorage();
    const newSessionId = generateUUID();
    
    // Clear old session data
    memorySessionId = newSessionId;
    
    if (storage) {
      try {
        storage.removeItem(SESSION_KEYS.PRIMARY);
        storage.removeItem(SESSION_KEYS.BACKUP);
        storage.removeItem(SESSION_KEYS.TIMESTAMP);
        
        storage.setItem(SESSION_KEYS.PRIMARY, newSessionId);
        storage.setItem(SESSION_KEYS.TIMESTAMP, Date.now().toString());
      } catch (error) {
        console.warn('Failed to refresh session in storage:', error);
      }
    }
    
    setupSessionSync(newSessionId);
    return newSessionId;
  },
  
  // Clear session (logout/scenario)
  clearSession: (): void => {
    if (typeof window === 'undefined') return;
    
    memorySessionId = null;
    const storage = getAvailableStorage();
    
    if (storage) {
      try {
        storage.removeItem(SESSION_KEYS.PRIMARY);
        storage.removeItem(SESSION_KEYS.BACKUP);
        storage.removeItem(SESSION_KEYS.TIMESTAMP);
      } catch (error) {
        console.warn('Failed to clear session from storage:', error);
      }
    }
  },
  
  // Validate session exists and is accessible
  validateSession: (): boolean => {
    if (typeof window === 'undefined') return false;
    
    try {
      const sessionId = getSessionId();
      return !!sessionId && sessionId !== 'server-default' && sessionId.length >= 10;
    } catch {
      return false;
    }
  },
  
  // Get session information for debugging
  getSessionInfo: () => {
    if (typeof window === 'undefined') return { available: false };
    
    const sessionId = getSessionId();
    const storage = getAvailableStorage();
    
    return {
      available: true,
      sessionId,
      storageType: storage === localStorage ? 'localStorage' : 
                   storage === sessionStorage ? 'sessionStorage' : 'memory',
      timestamp: storage ? storage.getItem(SESSION_KEYS.TIMESTAMP) : null,
      deviceFingerprint: getDeviceFingerprint()
    };
  }
};

// Export default for convenience
export default sessionManager;