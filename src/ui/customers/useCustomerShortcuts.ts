/**
 * useCustomerShortcuts — keyboard bindings for customer management.
 *
 *   Ctrl+Shift+C   toggles the CustomerManager modal
 *   Ctrl+Shift+[   previous customer in list (quick-switch)
 *   Ctrl+Shift+]   next customer
 *
 * The Ctrl+Shift+C binding dispatches a custom window event
 * "elbow:open-customer-manager" so the CustomerBadge component (which
 * owns the manager's open state) can toggle without a shared store.
 */

import { useEffect } from 'react';
import { useCustomerStore } from '@store/customerStore';

export const CUSTOMER_MANAGER_EVENT = 'elbow:open-customer-manager';

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}

export function useCustomerShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;

      // Ctrl+Shift+C → toggle manager
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(CUSTOMER_MANAGER_EVENT));
        return;
      }

      // Ctrl+Shift+[ / ] → prev / next customer
      if (e.ctrlKey && e.shiftKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        const st = useCustomerStore.getState();
        const list = Object.values(st.profiles).sort((a, b) => a.name.localeCompare(b.name));
        if (list.length === 0) return;
        const idx = list.findIndex((p) => p.id === st.activeCustomerId);
        const next = e.key === ']'
          ? list[(idx + 1) % list.length]!
          : list[(idx - 1 + list.length) % list.length]!;
        st.setActiveCustomer(next.id);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
