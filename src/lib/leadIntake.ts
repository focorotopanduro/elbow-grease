import type { ClientPath } from '../data/clientPaths';

export interface LeadFormData {
  name: string;
  email: string;
  phone: string;
  location: string;
  service: string;
  message: string;
  customerType?: string;
  preferredContact?: string;
}

export interface LeadDestinationResult {
  ok: boolean;
  status?: number;
  reason?: string;
}

export interface LeadIntake {
  id: string;
  createdAt: string;
  source: 'website_contact_form';
  page: {
    href: string;
    pathname: string;
  };
  customer: {
    name: string;
    email: string;
    phone: string;
    type: string;
    preferredContact: string;
  };
  property: {
    location: string;
  };
  project: {
    service: string;
    message: string;
  };
  route: null | {
    id: string;
    label: string;
    priority: string;
    intent: string;
    contingency: string;
    proof: string;
  };
  operations: {
    bucket: string;
    urgency: string;
    recommendedFollowUp: string;
  };
}

interface CreateLeadIntakeOptions {
  form: LeadFormData;
  path: ClientPath | null;
  id: string;
  href?: string;
  pathname?: string;
}

const FALLBACK_HREF = 'https://www.beitbuilding.com/';
const FALLBACK_PATHNAME = '/';

function cleanLine(value: string, fallback = ''): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

function cleanBlock(value: string, fallback = ''): string {
  const cleaned = value
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned || fallback;
}

function followUpForPriority(priority?: string): string {
  switch (priority) {
    case 'call-first':
      return 'Call first. Confirm active leak, water entry, tarp need, and photo availability.';
    case 'scope-first':
      return 'Review scope dependencies. Clarify permits, access, sequencing, and connected trades.';
    case 'work-order':
      return 'Confirm property count, access contact, tenant constraints, and documentation needs.';
    case 'estimate-first':
    default:
      return 'Prepare estimate follow-up. Confirm property access, timing, material needs, and photos.';
  }
}

function bucketFor(path: ClientPath | null, service: string): string {
  if (path?.id) return path.id;
  const normalized = service.toLowerCase();
  if (normalized.includes('storm') || normalized.includes('repair')) return 'storm';
  if (normalized.includes('roof')) return 'roof';
  if (normalized.includes('construction')) return 'build';
  return 'general';
}

export function createLeadIntake({
  form,
  path,
  id,
  href = typeof window !== 'undefined' ? window.location.href : FALLBACK_HREF,
  pathname = typeof window !== 'undefined' ? window.location.pathname : FALLBACK_PATHNAME,
}: CreateLeadIntakeOptions): LeadIntake {
  const service = cleanLine(form.service, path?.recommendedService ?? 'Other or multiple services');
  return {
    id,
    createdAt: new Date().toISOString(),
    source: 'website_contact_form',
    page: {
      href,
      pathname,
    },
    customer: {
      name: cleanLine(form.name),
      email: cleanLine(form.email),
      phone: cleanLine(form.phone),
      type: cleanLine(form.customerType ?? '', 'Not specified'),
      preferredContact: cleanLine(form.preferredContact ?? '', 'Call'),
    },
    property: {
      location: cleanLine(form.location, 'Not provided'),
    },
    project: {
      service,
      message: cleanBlock(form.message, 'Not provided'),
    },
    route: path
      ? {
        id: path.id,
        label: path.label,
        priority: path.priority,
        intent: path.analyticsIntent,
        contingency: path.contingency,
        proof: path.proof,
      }
      : null,
    operations: {
      bucket: bucketFor(path, service),
      urgency: path?.urgency ?? 'Standard estimate follow-up',
      recommendedFollowUp: followUpForPriority(path?.priority),
    },
  };
}

export function buildLeadEmailSubject(intake: LeadIntake): string {
  const route = intake.route?.label ?? intake.project.service;
  return `New estimate request - ${route}`;
}

export function buildLeadEmailBody(intake: LeadIntake): string {
  return [
    `Confirmation: ${intake.id}`,
    `Received: ${intake.createdAt}`,
    `Source page: ${intake.page.href}`,
    '',
    `Name: ${intake.customer.name}`,
    `Email: ${intake.customer.email}`,
    `Phone: ${intake.customer.phone}`,
    `Client type: ${intake.customer.type}`,
    `Preferred contact: ${intake.customer.preferredContact}`,
    `Location: ${intake.property.location}`,
    `Service: ${intake.project.service}`,
    intake.route ? `Route: ${intake.route.label} (${intake.route.priority})` : null,
    intake.route ? `Contingency: ${intake.route.contingency}` : null,
    intake.route ? `Proof: ${intake.route.proof}` : null,
    '',
    `Office bucket: ${intake.operations.bucket}`,
    `Recommended follow-up: ${intake.operations.recommendedFollowUp}`,
    '',
    'Project notes:',
    intake.project.message,
  ].filter((line): line is string => line !== null).join('\n');
}

export function buildLeadMailtoUrl(intake: LeadIntake, toEmail: string): string {
  return `mailto:${toEmail}?subject=${encodeURIComponent(buildLeadEmailSubject(intake))}&body=${encodeURIComponent(buildLeadEmailBody(intake))}`;
}

export function appendLeadToFormData(data: FormData, intake: LeadIntake): void {
  data.append('subject', buildLeadEmailSubject(intake));
  data.append('from_name', 'Beit Building Website');
  data.append('confirmation_id', intake.id);
  data.append('received_at', intake.createdAt);
  data.append('source_page', intake.page.href);
  data.append('name', intake.customer.name);
  data.append('email', intake.customer.email);
  data.append('phone', intake.customer.phone);
  data.append('client_type', intake.customer.type);
  data.append('preferred_contact', intake.customer.preferredContact);
  data.append('location', intake.property.location);
  data.append('service', intake.project.service);
  data.append('message', intake.project.message);
  data.append('office_bucket', intake.operations.bucket);
  data.append('recommended_follow_up', intake.operations.recommendedFollowUp);
  data.append('urgency', intake.operations.urgency);
  if (intake.route) {
    data.append('client_path', intake.route.id);
    data.append('client_path_label', intake.route.label);
    data.append('client_path_priority', intake.route.priority);
    data.append('client_path_intent', intake.route.intent);
    data.append('client_path_contingency', intake.route.contingency);
    data.append('client_path_proof', intake.route.proof);
  }
}

export function leadIntakeToCsvRow(intake: LeadIntake): string[] {
  return [
    intake.id,
    intake.createdAt,
    intake.customer.name,
    intake.customer.email,
    intake.customer.phone,
    intake.customer.type,
    intake.customer.preferredContact,
    intake.property.location,
    intake.project.service,
    intake.route?.label ?? '',
    intake.route?.priority ?? '',
    intake.operations.bucket,
    intake.operations.recommendedFollowUp,
    intake.project.message,
    intake.page.href,
  ];
}

export async function submitLeadEndpoint(
  endpoint: string,
  intake: LeadIntake,
  timeoutMs = 4500,
  token = '',
): Promise<LeadDestinationResult> {
  if (!endpoint) return { ok: false, reason: 'missing_endpoint' };
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['X-Lead-Inbox-Token'] = token;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(intake),
      headers,
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      reason: response.ok ? undefined : `endpoint_${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'endpoint_error',
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

/**
 * Flatten a `LeadIntake` (nested customer/property/project/operations
 * shape) into the flat JSON shape `/api/leads` validates against. The
 * server endpoint accepts either shape; this adapter is what the
 * desktop Contact form posts after the local-office collector wire-up.
 *
 * Why two shapes:
 *   - The nested `LeadIntake` is the SOURCE OF TRUTH on the client; it
 *     groups related fields (customer.name, customer.phone) so that
 *     existing CRM bridges + the local lead-inbox script keep working.
 *   - The flat shape matches what the mobile sim already posts
 *     (`name`/`phone`/`zip`), so /api/leads can validate one schema.
 */
export function leadIntakeToServerPayload(intake: LeadIntake): Record<string, unknown> {
  return {
    name: intake.customer.name,
    phone: intake.customer.phone,
    email: intake.customer.email,
    location: intake.property.location,
    clientType: intake.customer.type,
    preferredContact: intake.customer.preferredContact,
    service: intake.project.service,
    message: intake.project.message,
    confirmationId: intake.id,
    source: intake.source,
    page: intake.page.pathname,
    url: intake.page.href,
    ts: intake.createdAt,
    route: intake.route,
    operations: intake.operations,
    // Honeypot — must be empty. The server treats the form-side
    // `botcheck` empty input the same way; this just keeps the
    // schema consistent if a future code change wires it up.
    website: '',
  };
}

/**
 * Submit to the Beit Building `/api/leads` endpoint. This is the
 * production server-side path: it stores the lead in KV, sends the
 * branded HTML email to the operations contact (LEAD_NOTIFY_TO,
 * defaults to mom @ sandravasquezcgc@gmail.com), and fans out to
 * Slack / Discord webhooks when configured.
 *
 * Use this when:
 *   - The form is on www.beitbuilding.com (or a Vercel preview).
 *   - You want server-side guarantees (rate limit, dedup, KV archive)
 *     in addition to whatever Web3Forms is doing.
 *   - You want the rich HTML email the operations contact actually reads.
 */
export async function submitLeadServerApi(
  intake: LeadIntake,
  timeoutMs = 4500,
): Promise<LeadDestinationResult> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('/api/leads', {
      method: 'POST',
      body: JSON.stringify(leadIntakeToServerPayload(intake)),
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      // No credentials — /api/leads doesn't use cookies; explicit
      // 'omit' keeps the request smaller + reduces what an XSS could
      // do if it somehow injected a fetch into this surface.
      credentials: 'omit',
    });
    let reason: string | undefined;
    if (!response.ok) {
      try {
        const body = await response.json();
        reason = typeof body?.error === 'string' ? body.error : `api_${response.status}`;
      } catch {
        reason = `api_${response.status}`;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      reason,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'api_error',
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
