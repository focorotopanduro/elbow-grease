import { describe, expect, it } from 'vitest';
import { CLIENT_PATHS } from '../data/clientPaths';
import {
  appendLeadToFormData,
  buildLeadEmailBody,
  buildLeadEmailSubject,
  buildLeadMailtoUrl,
  createLeadIntake,
  leadIntakeToCsvRow,
  leadIntakeToServerPayload,
  type LeadFormData,
} from './leadIntake';

const FORM: LeadFormData = {
  name: '  Sandra  Example  ',
  email: ' owner@example.com ',
  phone: ' (407) 555-0199 ',
  location: ' Oviedo, FL ',
  service: ' Roof repair or storm damage ',
  message: ' Active leak near kitchen.\n\n\nPhotos available. ',
  customerType: ' Homeowner ',
  preferredContact: ' WhatsApp ',
};

describe('lead intake payloads', () => {
  it('normalizes contact form data into one reusable office record', () => {
    const intake = createLeadIntake({
      form: FORM,
      path: CLIENT_PATHS[0],
      id: 'BBC-TEST-1',
      href: 'https://www.beitbuilding.com/oviedo-roofing',
      pathname: '/oviedo-roofing',
    });

    expect(intake.customer.name).toBe('Sandra Example');
    expect(intake.customer.type).toBe('Homeowner');
    expect(intake.customer.preferredContact).toBe('WhatsApp');
    expect(intake.project.message).toBe('Active leak near kitchen.\n\nPhotos available.');
    expect(intake.route?.id).toBe('storm');
    expect(intake.operations.bucket).toBe('storm');
    expect(intake.operations.recommendedFollowUp).toMatch(/Call first/);
  });

  it('builds email fallback content from the same record', () => {
    const intake = createLeadIntake({
      form: FORM,
      path: CLIENT_PATHS[0],
      id: 'BBC-TEST-2',
      href: 'https://www.beitbuilding.com/',
      pathname: '/',
    });

    expect(buildLeadEmailSubject(intake)).toBe('New estimate request - Storm triage');
    expect(buildLeadEmailBody(intake)).toContain('Confirmation: BBC-TEST-2');
    expect(buildLeadMailtoUrl(intake, 'beitbuilding@gmail.com')).toContain('mailto:beitbuilding@gmail.com');
  });

  it('maps the same record into Web3Forms fields and CSV columns', () => {
    const intake = createLeadIntake({
      form: FORM,
      path: CLIENT_PATHS[1],
      id: 'BBC-TEST-3',
      href: 'https://www.beitbuilding.com/',
      pathname: '/',
    });
    const data = new FormData();

    appendLeadToFormData(data, intake);

    expect(data.get('confirmation_id')).toBe('BBC-TEST-3');
    expect(data.get('client_type')).toBe('Homeowner');
    expect(data.get('preferred_contact')).toBe('WhatsApp');
    expect(data.get('client_path')).toBe('roof');
    expect(data.get('office_bucket')).toBe('roof');
    expect(leadIntakeToCsvRow(intake)[0]).toBe('BBC-TEST-3');
  });

  it('flattens the same record for the /api/leads server endpoint', () => {
    const intake = createLeadIntake({
      form: FORM,
      path: CLIENT_PATHS[0],
      id: 'BBC-TEST-4',
      href: 'https://www.beitbuilding.com/oviedo-roofing',
      pathname: '/oviedo-roofing',
    });
    const flat = leadIntakeToServerPayload(intake);

    // Top-level fields the server validates against
    expect(flat.name).toBe('Sandra Example');
    expect(flat.email).toBe('owner@example.com');
    expect(flat.phone).toBe('(407) 555-0199');
    expect(flat.location).toBe('Oviedo, FL');
    expect(flat.clientType).toBe('Homeowner');
    expect(flat.preferredContact).toBe('WhatsApp');
    expect(flat.service).toBe('Roof repair or storm damage');
    expect(flat.confirmationId).toBe('BBC-TEST-4');
    expect(flat.page).toBe('/oviedo-roofing');
    expect(flat.url).toBe('https://www.beitbuilding.com/oviedo-roofing');
    // Honeypot must always be the empty string so the server's check
    // (`if (input.website) reject`) never trips on a real submission.
    expect(flat.website).toBe('');
    // Nested route + operations are preserved as nested objects (the
    // server's validateRoute / validateOperations handle them).
    expect(flat.route).toBeDefined();
    expect(flat.operations).toBeDefined();
  });
});
