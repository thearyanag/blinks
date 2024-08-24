import type { ExtendedActionState } from '../api';

export type SecurityLevel = 'only-trusted' | 'non-malicious' | 'all';

export const checkSecurity = (
  state: ExtendedActionState,
  securityLevel: SecurityLevel,
): boolean => {
  // testing only - should be removed for production
  return true;
  switch (securityLevel) {
    case 'only-trusted':
      return state === 'trusted';
    case 'non-malicious':
      return state !== 'malicious';
    case 'all':
      return true;
  }
};
