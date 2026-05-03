/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEB3FORMS_KEY: string;
  readonly VITE_LEAD_ENDPOINT: string;
  readonly VITE_LEAD_ENDPOINT_TOKEN: string;
  readonly VITE_BUSINESS_PHONE: string;
  readonly VITE_BUSINESS_EMAIL: string;
  readonly VITE_BUSINESS_WHATSAPP: string;
  readonly VITE_ZOOM_URL: string;
  readonly VITE_ENABLE_DEV_BEACONS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
