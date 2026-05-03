import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
} from 'react';
import TrustInline from '../components/TrustInline';
import type { ClientPathId } from '../data/clientPaths';
import { useClientPath } from '../hooks/useClientPath';
import { useFormPersistence } from '../hooks/useFormPersistence';
import { useFormAbandon } from '../hooks/useFormAbandon';
import { track, generateConfirmationId } from '../lib/analytics';
import { trackCta } from '../lib/interactions';
import { getCallWindowText } from '../lib/callWindow';
import {
  appendLeadToFormData,
  buildLeadMailtoUrl,
  createLeadIntake,
  submitLeadEndpoint,
  submitLeadServerApi,
  type LeadFormData,
  type LeadDestinationResult,
} from '../lib/leadIntake';
import './Contact.css';

const SERVICES = [
  'Roof replacement',
  'Roof repair or storm damage',
  'General construction',
  'Deck or fence installation',
  'Painting or siding',
  'Other or multiple services',
];

const SERVICE_CHOICES = [
  {
    value: 'Roof repair or storm damage',
    title: 'Leak / storm damage',
    note: 'Repair, tarp planning, claim notes',
  },
  {
    value: 'Roof replacement',
    title: 'Roof replacement',
    note: 'Shingle, tile, metal, or flat roof',
  },
  {
    value: 'General construction',
    title: 'Construction',
    note: 'Renovation, repair, or build-out',
  },
  {
    value: 'Other or multiple services',
    title: 'Not sure yet',
    note: 'We will help sort the scope',
  },
] as const;

const CONTACT_STEPS = [
  {
    title: 'Send basics',
    note: 'Name, phone, email, and the closest service type.',
  },
  {
    title: 'We review',
    note: 'Scope, location, timing, access, and documentation needs.',
  },
  {
    title: 'Next move',
    note: 'Repair, replacement, build path, or what can safely wait.',
  },
] as const;

const DATA_ROUTE_STEPS = [
  {
    title: 'Draft',
    note: 'Saved only in this browser until you send or clear it.',
  },
  {
    title: 'Office route',
    note: 'Service, city, urgency, and page context travel with the request.',
  },
  {
    title: 'Dual record',
    note: 'The same intake can feed email, CRM, and office archive.',
  },
] as const;

const CLIENT_TYPE_CHOICES = [
  {
    value: 'Homeowner',
    title: 'Homeowner',
    note: 'Roof, repair, remodel, exterior work',
    path: 'roof',
  },
  {
    value: 'Business / property manager',
    title: 'Business',
    note: 'Tenant access, work orders, repeat sites',
    path: 'manager',
  },
  {
    value: 'Storm / weather event',
    title: 'Storm event',
    note: 'Leak, wind, hail, tornado or hurricane concern',
    path: 'storm',
  },
] satisfies ReadonlyArray<{
  value: string;
  title: string;
  note: string;
  path: ClientPathId;
}>;

const CONTACT_METHOD_CHOICES = [
  {
    value: 'Call',
    title: 'Call',
    note: 'Fastest for urgent questions',
  },
  {
    value: 'WhatsApp',
    title: 'WhatsApp',
    note: 'Easy photos and quick notes',
  },
  {
    value: 'Zoom',
    title: 'Zoom',
    note: 'Best for business planning',
  },
  {
    value: 'Email',
    title: 'Email',
    note: 'Written trail for scope details',
  },
] as const;

const PHONE = import.meta.env.VITE_BUSINESS_PHONE || '+14079426459';
const EMAIL = import.meta.env.VITE_BUSINESS_EMAIL || 'beitbuilding@gmail.com';
const WHATSAPP = import.meta.env.VITE_BUSINESS_WHATSAPP || '+14079426459';
const ZOOM_URL = import.meta.env.VITE_ZOOM_URL || '';
const ACCESS_KEY = import.meta.env.VITE_WEB3FORMS_KEY || '';
const LEAD_ENDPOINT = import.meta.env.VITE_LEAD_ENDPOINT || '';
const LEAD_ENDPOINT_TOKEN = import.meta.env.VITE_LEAD_ENDPOINT_TOKEN || '';
const WHATSAPP_URL = `https://wa.me/${WHATSAPP.replace(/\D/g, '')}`;

type Status = 'idle' | 'sending' | 'success' | 'error' | 'email';

type FieldName = keyof LeadFormData;
type FieldErrors = Partial<Record<FieldName, string>>;

const REQUIRED_FIELDS: FieldName[] = ['name', 'email', 'phone', 'service'];

const INITIAL_FORM: LeadFormData = {
  name: '',
  email: '',
  phone: '',
  location: '',
  service: '',
  message: '',
  customerType: '',
  preferredContact: 'Call',
};

/** RFC 5322-light email regex — strict enough to catch typos, lenient
 *  enough to accept the long-tail of valid real addresses. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateLeadForm(form: LeadFormData): FieldErrors {
  const errors: FieldErrors = {};

  REQUIRED_FIELDS.forEach((field) => {
    if (!(form[field] ?? '').trim()) errors[field] = 'Required';
  });

  if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) {
    errors.email = 'Enter a valid email address';
  }

  return errors;
}

/** Type guard for restored localStorage payloads — drops corrupt or
 *  schema-mismatched entries instead of letting them poison the form. */
function isLeadFormData(v: unknown): v is LeadFormData {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.name === 'string' &&
    typeof obj.email === 'string' &&
    typeof obj.phone === 'string' &&
    typeof obj.location === 'string' &&
    typeof obj.service === 'string' &&
    typeof obj.message === 'string' &&
    (typeof obj.customerType === 'undefined' || typeof obj.customerType === 'string') &&
    (typeof obj.preferredContact === 'undefined' || typeof obj.preferredContact === 'string')
  );
}

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const MailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <path d="m22 6-10 7L2 6" />
  </svg>
);

const PinIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.6 6.32A7.85 7.85 0 0 0 12.05 4a7.94 7.94 0 0 0-6.88 11.93L4 20l4.18-1.1a7.93 7.93 0 0 0 3.86 1h.01a7.94 7.94 0 0 0 5.55-13.58zM12.05 18.6h-.01a6.6 6.6 0 0 1-3.36-.92l-.24-.14-2.49.65.66-2.42-.16-.25a6.6 6.6 0 1 1 12.25-3.49 6.6 6.6 0 0 1-6.65 6.57zm3.62-4.93c-.2-.1-1.18-.58-1.36-.65-.18-.07-.31-.1-.45.1-.13.2-.51.65-.62.78-.12.13-.23.15-.43.05a5.4 5.4 0 0 1-1.6-.99 6 6 0 0 1-1.1-1.38c-.12-.2 0-.31.09-.41.09-.09.2-.23.3-.35.1-.12.13-.2.2-.33.06-.13.03-.25-.02-.35-.05-.1-.45-1.08-.62-1.48-.16-.39-.32-.34-.45-.34l-.38-.01c-.13 0-.35.05-.53.25-.18.2-.7.68-.7 1.66 0 .98.71 1.92.81 2.05.1.13 1.4 2.13 3.39 2.99.47.2.84.32 1.13.42.48.15.91.13 1.25.08.38-.06 1.18-.48 1.34-.95.17-.46.17-.86.12-.94-.05-.08-.18-.13-.38-.23z" />
  </svg>
);

const VideoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14" />
    <rect x="3" y="6" width="12" height="12" rx="2" />
  </svg>
);

async function submitWeb3Forms(data: FormData): Promise<LeadDestinationResult> {
  try {
    const res = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      body: data,
    });
    const json = await res.json();
    return {
      ok: Boolean(json.success),
      status: res.status,
      reason: json.success
        ? undefined
        : typeof json.message === 'string'
          ? json.message
          : 'backend_rejected',
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'network_error',
    };
  }
}

export default function Contact() {
  const [status, setStatus] = useState<Status>('idle');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [confirmationId, setConfirmationId] = useState('');
  const [callWindow, setCallWindow] = useState('');
  const [errorReason, setErrorReason] = useState('');
  const { path: activePath, selectPath } = useClientPath({ initial: 'stored-only' });
  const fieldRefs = useRef<
    Partial<Record<FieldName, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>>
  >({});

  // Persistent form state — auto-saves to localStorage with a 350ms
  // debounce, restores on mount. Cross-tab sync included. The user
  // can close the tab, come back tomorrow, and pick up exactly where
  // they left off — major win on long-form lead capture.
  const [form, setForm, { clear, restoredFromStorage }] =
    useFormPersistence<LeadFormData>({
      key: 'lead_form_v1',
      initial: INITIAL_FORM,
      validate: (v): v is LeadFormData => isLeadFormData(v),
    });

  const autoServiceRef = useRef(false);

  useEffect(() => {
    if (!activePath) return;
    const canApply = !form.service.trim() || autoServiceRef.current;
    if (!canApply || form.service === activePath.recommendedService) return;
    autoServiceRef.current = true;
    setForm({ ...form, service: activePath.recommendedService });
  }, [activePath, form, setForm]);

  // Track first-field-focus → fires `lead_form_start` once per session.
  const startedRef = useRef(false);
  const onFirstFocus = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setInteracted(true);
    track('lead_form_start', { surface: 'desktop' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Submit ref — abandon hook reads this to skip the abandon event when
  // the user actually completed the funnel.
  const submittedRef = useRef(false);

  // hasContent feeds the abandonment hook — only fire abandon if the
  // user typed at least one character anywhere.
  const hasContent = useMemo(
    () => Object.values(form).some((v) => typeof v === 'string' && v.trim().length > 0),
    [form],
  );
  useFormAbandon(hasContent, submittedRef);
  const handoffSteps = activePath?.handoff ?? CONTACT_STEPS;

  // Fire `lead_form_restored` once when a saved draft was restored at
  // mount. Lets us measure how often persistence is rescuing leads.
  useEffect(() => {
    if (restoredFromStorage) {
      track('lead_form_restored', { surface: 'desktop' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tier 4 abandonment-recovery polish — once on mount after a draft
  // is restored, briefly pulse the first unfilled required field so
  // the visitor's eye lands on it. Yellow outline pulses for 2.2s,
  // then fades. Idempotent via pulsedRef so it never fires twice in
  // a session even if hasContent toggles.
  const pulsedRef = useRef(false);
  useEffect(() => {
    if (pulsedRef.current) return;
    if (!restoredFromStorage || !hasContent) return;
    pulsedRef.current = true;
    const requiredFields: Array<keyof LeadFormData> = [
      'name',
      'email',
      'phone',
      'service',
    ];
    const firstEmpty = requiredFields.find((f) => !form[f]?.trim());
    if (!firstEmpty) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `[name="${firstEmpty}"]`,
      );
      if (!el) return;
      el.classList.add('field--pulse');
      window.setTimeout(() => el.classList.remove('field--pulse'), 2200);
    }, 250);
    return () => window.clearTimeout(t);
  }, [restoredFromStorage, hasContent, form]);

  // "(saved)" indicator next to non-empty field labels — only when the
  // form was restored AND the user hasn't started typing yet. Once the
  // user touches any field, all saved indicators clear (signals the
  // form is now in active editing mode, not passive review).
  const [interacted, setInteracted] = useState(false);
  const showSavedFor = (field: keyof LeadFormData): boolean =>
    restoredFromStorage && !interacted && typeof form[field] === 'string' && Boolean(form[field]?.trim());

  const registerField =
    (field: FieldName) =>
    (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null) => {
      fieldRefs.current[field] = el;
    };

  const errorId = (field: FieldName) => `${field}-error`;

  // Focus management — when status transitions to 'success', move focus
  // to the confirmation message so screen readers + keyboard users see
  // the new state without hunting for it.
  const successRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (status === 'success' && successRef.current) {
      successRef.current.focus();
    }
  }, [status]);

  const onChange = useCallback(
    <K extends keyof LeadFormData>(field: K, value: LeadFormData[K]) => {
      if (field === 'service') autoServiceRef.current = false;
      setForm({ ...form, [field]: value });
      setFieldErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      });
    },
    [form, setForm],
  );

  const onEmailBlur = (e: FocusEvent<HTMLInputElement>) => {
    const value = e.target.value.trim();
    if (!value) {
      setFieldErrors((current) => {
        if (!current.email) return current;
        const next = { ...current };
        delete next.email;
        return next;
      });
      return;
    }
    setFieldErrors((current) => {
      const next = { ...current };
      if (EMAIL_RE.test(value)) delete next.email;
      else next.email = 'Enter a valid email address';
      return next;
    });
  };

  const onClearDraft = () => {
    setForm(INITIAL_FORM);
    setFieldErrors({});
    clear();
    track('lead_form_restored', { surface: 'desktop', cleared: true });
  };

  const chooseClientType = (value: string, path: ClientPathId) => {
    setForm({ ...form, customerType: value });
    selectPath(path, 'contact_client_type');
    track('cta_click', {
      cta: 'client_type_select',
      placement: 'contact_form',
      client_type: value,
      path,
    });
    setInteracted(true);
  };

  const choosePreferredContact = (value: string) => {
    setForm({ ...form, preferredContact: value });
    track('cta_click', {
      cta: 'preferred_contact_select',
      placement: 'contact_form',
      preferred_contact: value,
    });
    setInteracted(true);
  };

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    track('lead_form_submit_attempt', {
      surface: 'desktop',
      // Flag whether the email looks valid client-side at attempt time —
      // helps debug "why does the submit count exceed the success count?"
      email_valid: EMAIL_RE.test(form.email.trim()),
      path: activePath?.id,
      intent: activePath?.analyticsIntent,
      priority: activePath?.priority,
      client_type: form.customerType,
      preferred_contact: form.preferredContact,
    });

    const validationErrors = validateLeadForm(form);
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      track('lead_form_submit_error', {
        surface: 'desktop',
        reason: 'client_validation',
        fields: Object.keys(validationErrors).join(','),
      });
      const firstInvalid = REQUIRED_FIELDS.find((field) => validationErrors[field]);
      if (firstInvalid) fieldRefs.current[firstInvalid]?.focus();
      return;
    }

    const id = generateConfirmationId();
    const intake = createLeadIntake({
      form,
      path: activePath,
      id,
    });

    setStatus('sending');
    // PARALLEL FAN-OUT — every destination submits at once so the user
    // sees the result as soon as ANY of them succeeds. Each is opt-in
    // / best-effort:
    //   - submitLeadServerApi (/api/leads) is ALWAYS attempted in
    //     production; it handles KV storage + the rich HTML email to
    //     the operations contact (LEAD_NOTIFY_TO env, defaults to
    //     mom @ sandravasquezcgc@gmail.com). On localhost, /api/leads
    //     simply 404s — the function then resolves to a non-ok result
    //     and we fall back to Web3Forms / mailto:.
    //   - submitWeb3Forms is the legacy path; remains the primary
    //     production destination because it's already proven.
    //   - submitLeadEndpoint mirrors to a second URL when configured
    //     (local lead-inbox collector during owner training, or a CRM
    //     bridge in the future).
    const submissions: Array<Promise<LeadDestinationResult | null>> = [];

    // Always try the server API. On localhost:5173 this'll 404; the
    // resolver below treats that as "not the primary success" and the
    // mailto: fallback still kicks in when no other destination works.
    submissions.push(submitLeadServerApi(intake));

    if (ACCESS_KEY) {
      const data = new FormData();
      data.append('access_key', ACCESS_KEY);
      appendLeadToFormData(data, intake);
      data.append('botcheck', '');
      submissions.push(submitWeb3Forms(data));
    } else {
      submissions.push(Promise.resolve(null));
    }

    if (LEAD_ENDPOINT) {
      submissions.push(submitLeadEndpoint(LEAD_ENDPOINT, intake, 4500, LEAD_ENDPOINT_TOKEN));
    } else {
      submissions.push(Promise.resolve(null));
    }

    const [serverApiResult, web3Result, endpointResult] = await Promise.all(submissions);
    // Success priority: server API first (rich email + KV) → Web3Forms
    // → optional mirror endpoint. The first one that returns ok=true
    // becomes the user-visible "submitted" status.
    const primaryResult = serverApiResult?.ok
      ? serverApiResult
      : web3Result?.ok
        ? web3Result
        : endpointResult?.ok
          ? endpointResult
          : (serverApiResult ?? web3Result ?? endpointResult);
    const archiveStatus = endpointResult
      ? endpointResult.ok ? 'ok' : endpointResult.reason ?? 'error'
      : 'not_configured';
    const serverStatus = serverApiResult
      ? serverApiResult.ok
        ? 'ok'
        : serverApiResult.reason ?? 'error'
      : 'not_attempted';

    // No destination accepted AND no live endpoint or Web3Forms — fall
    // back to mailto: so the visitor still has a way to reach the team.
    if (!primaryResult?.ok && !ACCESS_KEY && !serverApiResult?.ok && !LEAD_ENDPOINT) {
      const mailto = buildLeadMailtoUrl(intake, EMAIL);
      track('lead_form_mailto_fallback', {
        surface: 'desktop',
        confirmation_id: id,
        path: activePath?.id,
        intent: activePath?.analyticsIntent,
        priority: activePath?.priority,
        client_type: intake.customer.type,
        preferred_contact: intake.customer.preferredContact,
      });
      window.location.href = mailto;
      setStatus('email');
      return;
    }

    if (primaryResult?.ok) {
      setConfirmationId(id);
      setCallWindow(getCallWindowText());
      submittedRef.current = true;
      track('lead_form_submit_success', {
        surface: 'desktop',
        confirmation_id: id,
        path: activePath?.id,
        intent: activePath?.analyticsIntent,
        priority: activePath?.priority,
        office_bucket: intake.operations.bucket,
        archive_status: archiveStatus,
        server_status: serverStatus,
        client_type: intake.customer.type,
        preferred_contact: intake.customer.preferredContact,
        primary_destination: serverApiResult?.ok
          ? 'server_api'
          : web3Result?.ok
            ? 'web3forms'
            : 'mirror_endpoint',
      });
      clear(); // wipe draft so a future visit starts fresh
      setForm(INITIAL_FORM);
      setStatus('success');
      return;
    }

    const reason = primaryResult?.reason ?? 'no_destination_accepted';
    setErrorReason(reason);
    track('lead_form_submit_error', {
      surface: 'desktop',
      reason,
      path: activePath?.id,
      intent: activePath?.analyticsIntent,
      priority: activePath?.priority,
      archive_status: archiveStatus,
      server_status: serverStatus,
      client_type: intake.customer.type,
      preferred_contact: intake.customer.preferredContact,
    });
    setStatus('error');
  }

  return (
    <section id="contact" className="contact section section--dark">
      <div className="container contact__inner">
        <div className="contact__intro">
          <p className="eyebrow">Estimate Request</p>
          <h2 className="contact__title">
            Request a<br />
            {' '}
            <em>Free Estimate</em>
          </h2>
          <p className="contact__lead">
            Tell us what is happening at the property. We will use the details
            to prepare the right next step before we follow up.
          </p>

          <ul className="contact__assurance" aria-label="Estimate process highlights">
            <li>Free estimate</li>
            <li>DBPR-active</li>
            <li>Photo notes</li>
          </ul>

          <ul className="contact__channels">
            <li>
              <a
                href={`tel:${PHONE}`}
                className="contact__channel"
                data-cta-source="contact_section_call"
                onClick={trackCta('call_phone', 'contact_section')}
              >
                <span className="contact__channel-icon"><PhoneIcon /></span>
                <span className="contact__channel-body">
                  <span className="contact__channel-label">Phone</span>
                  <span className="contact__channel-value">(407) 942-6459</span>
                </span>
              </a>
            </li>
            <li>
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="contact__channel"
                data-cta-source="contact_section_whatsapp"
                onClick={trackCta('whatsapp', 'contact_section')}
              >
                <span className="contact__channel-icon"><WhatsAppIcon /></span>
                <span className="contact__channel-body">
                  <span className="contact__channel-label">WhatsApp</span>
                  <span className="contact__channel-value">Send photos or quick notes</span>
                </span>
              </a>
            </li>
            {ZOOM_URL && (
              <li>
                <a
                  href={ZOOM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="contact__channel"
                  data-cta-source="contact_section_zoom"
                  onClick={trackCta('zoom', 'contact_section')}
                >
                  <span className="contact__channel-icon"><VideoIcon /></span>
                  <span className="contact__channel-body">
                    <span className="contact__channel-label">Zoom</span>
                    <span className="contact__channel-value">Business planning call</span>
                  </span>
                </a>
              </li>
            )}
            <li>
              <a
                href={`mailto:${EMAIL}`}
                className="contact__channel"
                data-cta-source="contact_section_email"
                onClick={trackCta('email', 'contact_section')}
              >
                <span className="contact__channel-icon"><MailIcon /></span>
                <span className="contact__channel-body">
                  <span className="contact__channel-label">Email</span>
                  <span className="contact__channel-value">{EMAIL}</span>
                </span>
              </a>
            </li>
            <li>
              <a
                href="https://maps.google.com/?q=2703+Dobbin+Dr+Orlando+FL+32817"
                target="_blank"
                rel="noopener noreferrer"
                className="contact__channel"
                data-cta-source="contact_section_directions"
                onClick={trackCta('directions', 'contact_section')}
              >
                <span className="contact__channel-icon"><PinIcon /></span>
                <span className="contact__channel-body">
                  <span className="contact__channel-label">Address</span>
                  <span className="contact__channel-value">2703 Dobbin Dr, Orlando, FL 32817</span>
                </span>
              </a>
            </li>
          </ul>

          {/* Trust block — secondary verifiable credentials anchored beside
              the contact info, where most visitors look before reaching out. */}
          <div className="contact__trust">
            <TrustInline variant="contact" heading="Verify our state credentials" />
          </div>
        </div>

        <div className="contact__formwrap">
          <div className="contact__formhead">
            <p className="contact__formintro">
              {activePath ? activePath.intakePrompt : 'Tell us what you need'}
            </p>
            <p className="contact__formhint">
              {activePath
                ? activePath.contactHint
                : 'Name, phone, email, and service type are enough to start. Mention photos or extra notes when you have them.'}
            </p>
          </div>

          {activePath && (
            <div className="contact__pathnote" role="status" aria-live="polite">
              <span>Active route</span>
              <strong>{activePath.label}</strong>
              <small>{activePath.contingency}</small>
            </div>
          )}

          <ol className="contact__handoff" aria-label="What happens after you request an estimate">
            {handoffSteps.map((step, index) => (
              <li key={step.title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{step.title}</strong>
                <p>{step.note}</p>
              </li>
            ))}
          </ol>

          {/* Restored-draft banner — non-dismissive, polite, with a clear
              way to wipe the draft if the user wanted to start over. Only
              renders in idle status (not after submit). */}
          <div className="contact__routing" aria-label="How estimate request details are handled">
            {DATA_ROUTE_STEPS.map((step) => (
              <div key={step.title}>
                <strong>{step.title}</strong>
                <span>{step.note}</span>
              </div>
            ))}
          </div>

          {restoredFromStorage && status === 'idle' && hasContent && (
            <div
              className="contact__restored"
              role="status"
              aria-live="polite"
            >
              <span className="contact__restored-icon" aria-hidden="true">✓</span>
              <span className="contact__restored-text">
                We saved your spot — picking up where you left off.
              </span>
              <button
                type="button"
                className="contact__restored-clear"
                onClick={onClearDraft}
              >
                Clear &amp; start over
              </button>
            </div>
          )}

          {Object.keys(fieldErrors).length > 0 && (
            <div className="contact__formalert" role="alert" aria-live="assertive">
              <strong>Check a few details.</strong>
              <span>Name, email, phone, and service type are required so we can follow up clearly.</span>
            </div>
          )}

          <form className="contact__form" onSubmit={onSubmit} noValidate>
            <input type="hidden" name="botcheck" />
            <input type="hidden" name="customer_type" value={form.customerType ?? ''} />
            <input type="hidden" name="preferred_contact" value={form.preferredContact ?? ''} />
            {activePath && (
              <>
                <input type="hidden" name="client_path" value={activePath.id} />
                <input type="hidden" name="client_path_label" value={activePath.label} />
                <input type="hidden" name="client_path_priority" value={activePath.priority} />
                <input type="hidden" name="client_path_contingency" value={activePath.contingency} />
              </>
            )}

            <label className={`field field--half ${fieldErrors.name ? 'field--invalid' : ''}`}>
              <span className="field__label">
                Full Name *
                {showSavedFor('name') && (
                  <span className="field__saved" aria-hidden="true">(saved)</span>
                )}
                {fieldErrors.name && (
                  <span id={errorId('name')} className="field__error" role="alert">
                    {' - '}{fieldErrors.name}
                  </span>
                )}
              </span>
              <input
                ref={registerField('name')}
                type="text"
                name="name"
                required
                autoComplete="name"
                placeholder="Your name"
                value={form.name}
                onChange={(e) => onChange('name', e.target.value)}
                onFocus={onFirstFocus}
                aria-invalid={fieldErrors.name ? true : undefined}
                aria-describedby={fieldErrors.name ? errorId('name') : undefined}
              />
            </label>

            <label className={`field field--half ${fieldErrors.email ? 'field--invalid' : ''}`}>
              <span className="field__label">
                Email Address *
                {showSavedFor('email') && (
                  <span className="field__saved" aria-hidden="true">(saved)</span>
                )}
                {fieldErrors.email && (
                  <span id={errorId('email')} className="field__error" role="alert">
                    {' - '}{fieldErrors.email}
                  </span>
                )}
              </span>
              <input
                ref={registerField('email')}
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => onChange('email', e.target.value)}
                onBlur={onEmailBlur}
                onFocus={onFirstFocus}
                aria-invalid={fieldErrors.email ? true : undefined}
                aria-describedby={fieldErrors.email ? errorId('email') : undefined}
              />
            </label>

            <label className={`field field--half ${fieldErrors.phone ? 'field--invalid' : ''}`}>
              <span className="field__label">
                Phone Number *
                {showSavedFor('phone') && (
                  <span className="field__saved" aria-hidden="true">(saved)</span>
                )}
                {fieldErrors.phone && (
                  <span id={errorId('phone')} className="field__error" role="alert">
                    {' - '}{fieldErrors.phone}
                  </span>
                )}
              </span>
              <input
                ref={registerField('phone')}
                type="tel"
                name="phone"
                required
                autoComplete="tel"
                inputMode="tel"
                placeholder="Your phone number"
                value={form.phone}
                onChange={(e) => onChange('phone', e.target.value)}
                onFocus={onFirstFocus}
                aria-invalid={fieldErrors.phone ? true : undefined}
                aria-describedby={fieldErrors.phone ? errorId('phone') : undefined}
              />
            </label>

            <label className="field field--half">
              <span className="field__label">
                Property Location / City
                {showSavedFor('location') && (
                  <span className="field__saved" aria-hidden="true">(saved)</span>
                )}
              </span>
              <input
                ref={registerField('location')}
                type="text"
                name="location"
                autoComplete="address-level2"
                placeholder="Orlando, Winter Park, Oviedo..."
                value={form.location}
                onChange={(e) => onChange('location', e.target.value)}
                onFocus={onFirstFocus}
              />
            </label>

            <div className={`field field--full ${fieldErrors.service ? 'field--invalid' : ''}`}>
              <span id="service-label" className="field__label">
                Service Needed *
                {showSavedFor('service') && (
                  <span className="field__saved" aria-hidden="true">(saved)</span>
                )}
                {fieldErrors.service && (
                  <span id={errorId('service')} className="field__error" role="alert">
                    {' - '}{fieldErrors.service}
                  </span>
                )}
              </span>
              <div className="service-picker" role="group" aria-labelledby="service-label">
                {SERVICE_CHOICES.map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    className={`service-picker__option ${form.service === choice.value ? 'is-selected' : ''}`}
                    aria-pressed={form.service === choice.value}
                    onClick={() => {
                      onFirstFocus();
                      onChange('service', choice.value);
                    }}
                  >
                    <span className="service-picker__title">{choice.title}</span>
                    <span className="service-picker__note">{choice.note}</span>
                  </button>
                ))}
              </div>
              <select
                ref={registerField('service')}
                name="service"
                required
                value={form.service}
                onChange={(e) => onChange('service', e.target.value)}
                onFocus={onFirstFocus}
                aria-invalid={fieldErrors.service ? true : undefined}
                aria-describedby={fieldErrors.service ? errorId('service') : undefined}
              >
                <option value="" disabled>Choose the closest match...</option>
                {SERVICES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="field field--full">
              <span id="client-type-label" className="field__label">
                Who are we helping?
                {showSavedFor('customerType') && (
                  <span className="field__saved" aria-hidden="true">(saved)</span>
                )}
              </span>
              <div className="contact-choice-grid contact-choice-grid--client" role="group" aria-labelledby="client-type-label">
                {CLIENT_TYPE_CHOICES.map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    className={`contact-choice ${form.customerType === choice.value ? 'is-selected' : ''}`}
                    aria-pressed={form.customerType === choice.value}
                    onClick={() => {
                      onFirstFocus();
                      chooseClientType(choice.value, choice.path);
                    }}
                  >
                    <span className="contact-choice__title">{choice.title}</span>
                    <span className="contact-choice__note">{choice.note}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="field field--full">
              <span id="preferred-contact-label" className="field__label">
                Preferred follow-up
                {showSavedFor('preferredContact') && (
                  <span className="field__saved" aria-hidden="true">(saved)</span>
                )}
              </span>
              <div className="contact-choice-grid contact-choice-grid--method" role="group" aria-labelledby="preferred-contact-label">
                {CONTACT_METHOD_CHOICES.map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    className={`contact-choice ${form.preferredContact === choice.value ? 'is-selected' : ''}`}
                    aria-pressed={form.preferredContact === choice.value}
                    onClick={() => {
                      onFirstFocus();
                      choosePreferredContact(choice.value);
                    }}
                  >
                    <span className="contact-choice__title">{choice.title}</span>
                    <span className="contact-choice__note">{choice.note}</span>
                  </button>
                ))}
              </div>
              <span className="field__hint">
                Choose what feels easiest. For Zoom, include the best time window in the notes.
              </span>
            </div>

            <label className="field field--full">
              <span className="field__label">
                Tell us about your project
                {showSavedFor('message') && (
                  <span className="field__saved" aria-hidden="true">(saved)</span>
                )}
              </span>
              <textarea
                ref={registerField('message')}
                name="message"
                rows={4}
                placeholder={activePath?.messagePlaceholder ?? 'What happened? Where is the issue? Is there an insurance claim, leak, deadline, or photo record?'}
                value={form.message}
                onChange={(e) => onChange('message', e.target.value)}
                onFocus={onFirstFocus}
              />
              <span className="field__hint">
                Optional, but useful: timing, visible damage, access notes, whether photos are available, or insurance claim status.
              </span>
            </label>

            <div className="field--full contact__submit">
              <button
                type="submit"
                className="btn btn--primary contact__submit-btn"
                disabled={status === 'sending'}
                data-cta-source="contact_form_submit"
              >
                {status === 'sending' ? 'Sending...' : (
                  <>Request Free Estimate <span aria-hidden="true">-&gt;</span></>
                )}
              </button>
              <p className="contact__disclaimer">
                Direct follow-up &middot; No spam &middot; Florida DBPR licensed
              </p>
              <p className="contact__privacy">
                <span className="contact__privacy-lock" aria-hidden="true" />
                Your information stays with us. We never share or sell contact details.
              </p>

              {status === 'success' && (
                <div
                  ref={successRef}
                  tabIndex={-1}
                  className="contact__msg contact__msg--ok"
                  role="status"
                  aria-live="polite"
                >
                  <strong>Thanks — we received your request.</strong>
                  {callWindow && (
                    <>
                      {' '}A team member will call you{' '}
                      <strong>{callWindow}</strong>.
                    </>
                  )}
                  {confirmationId && (
                    <span className="contact__msg-receipt">
                      Confirmation #{confirmationId}
                    </span>
                  )}
                </div>
              )}
              {status === 'error' && (
                <p
                  className="contact__msg contact__msg--err"
                  role="alert"
                  aria-live="assertive"
                >
                  Something went wrong{errorReason ? ` (${errorReason})` : ''} —
                  please try again, or call us at (407) 942-6459.
                </p>
              )}
              {status === 'email' && (
                <p className="contact__msg contact__msg--warn" role="status">
                  Your email app should open with the estimate request details. If it
                  does not, call us at (407) 942-6459.
                </p>
              )}
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
