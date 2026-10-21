import type { EnvironmentJSON } from "@clerk/shared/types"

import type { ClerkInstance } from "./views.ts"

/** An identifier attribute: whether it is on, required, and how it is verified and used. */
function attribute(
  enabled: boolean,
  options: { required?: boolean; firstFactors?: string[]; verifications?: string[] } = {},
) {
  return {
    enabled,
    required: options.required ?? false,
    used_for_first_factor: (options.firstFactors ?? []).length > 0,
    first_factors: options.firstFactors ?? [],
    used_for_second_factor: false,
    second_factors: [],
    verifications: options.verifications ?? [],
    verify_at_sign_up: (options.verifications ?? []).length > 0,
    immutable: false,
  }
}

/** The attributes a sign-in uses: email and, unless sign-in is by code, a password. */
function attributes(instance: ClerkInstance) {
  return {
    email_address: attribute(true, {
      required: true,
      firstFactors: ["email_code"],
      verifications: ["email_code"],
    }),
    phone_number: attribute(false),
    username: attribute(false),
    web3_wallet: attribute(false),
    first_name: attribute(true),
    last_name: attribute(true),
    password: attribute(instance.password, { required: instance.password }),
    authenticator_app: attribute(false),
    ticket: attribute(true),
    backup_code: attribute(false),
    passkey: attribute(false),
  }
}

/** The sign-in methods the instance offers, as the auth config names them. */
function authConfig(instance: ClerkInstance) {
  const firstFactors = [
    "email_code",
    ...(instance.password ? ["password", "reset_password_email_code"] : []),
    "ticket",
  ]

  return {
    object: "auth_config",
    id: `aac_${instance.slug}`,
    first_name: "on",
    last_name: "on",
    email_address: "on",
    phone_number: "off",
    username: "off",
    password: instance.password ? "required" : "on",
    identification_requirements: [["email_address"], []],
    identification_strategies: ["email_address"],
    first_factors: firstFactors,
    second_factors: [],
    email_address_verification_strategies: ["email_code"],
    single_session_mode: false,
    enhanced_email_deliverability: false,
    test_mode: true,
    cookieless_dev: true,
    url_based_session_syncing: true,
    claimed_at: null,
    reverification: true,
    native_settings: {
      object: "native_settings",
      api_enabled: true,
      trusted_device_sign_in_enabled: false,
      trusted_device_enrollment_prompt_after_sign_in_enabled: false,
      trusted_device_enrollment_prompt_after_sign_up_enabled: false,
    },
  }
}

/** The URLs the browser SDK sends people to, on the instance's Account Portal. */
function displayUrls(instance: ClerkInstance) {
  const portal = `https://${instance.accountsHost}`

  return {
    home_url: `${portal}/default-redirect`,
    sign_in_url: `${portal}/sign-in`,
    sign_up_url: `${portal}/sign-up`,
    user_profile_url: `${portal}/user`,
    waitlist_url: `${portal}/waitlist`,
    oauth_consent_url: `${portal}/oauth-consent`,
    oauth_device_verification_url: `${portal}/device`,
    after_sign_in_url: `${portal}/default-redirect`,
    after_sign_up_url: `${portal}/default-redirect`,
    after_sign_out_one_url: `${portal}/sign-in/choose`,
    after_sign_out_all_url: `${portal}/sign-in`,
    after_switch_session_url: `${portal}/default-redirect`,
    after_join_waitlist_url: `${portal}/default-redirect`,
    organization_profile_url: `${portal}/organization`,
    create_organization_url: `${portal}/create-organization`,
    after_leave_organization_url: `${portal}/default-redirect`,
    after_create_organization_url: `${portal}/default-redirect`,
    logo_link_url: `${portal}/default-redirect`,
  }
}

/** The theme a new instance starts with. */
const THEME = {
  buttons: {
    font_color: "#ffffff",
    font_family: '"Source Sans Pro", sans-serif',
    font_weight: "600",
  },
  general: {
    color: "#6c47ff",
    padding: "1em",
    box_shadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
    font_color: "#151515",
    font_family: '"Source Sans Pro", sans-serif',
    border_radius: "0.5em",
    background_color: "#ffffff",
    label_font_weight: "600",
  },
  accounts: { background_color: "#ffffff" },
}

/** The display settings: the instance's name, the default theme, no captcha or legal links. */
function displayConfig(instance: ClerkInstance) {
  return {
    object: "display_config" as const,
    id: `display_config_${instance.slug}`,
    instance_environment_type: "development",
    application_name: instance.slug,
    theme: THEME,
    preferred_sign_in_strategy: instance.password ? ("password" as const) : ("otp" as const),
    logo_image_url: "",
    favicon_image_url: "",
    ...displayUrls(instance),
    support_email: null,
    branded: true,
    experimental_force_oauth_first: false,
    clerk_js_version: "5",
    show_devmode_warning: false,
    google_one_tap_client_id: "",
    help_url: null,
    privacy_policy_url: null,
    terms_url: null,
    logo_url: null,
    favicon_url: null,
    logo_image: null,
    favicon_image: null,
    captcha_public_key: null,
    captcha_widget_type: null,
    captcha_public_key_invisible: null,
    captcha_provider: null,
    captcha_oauth_bypass: [],
  }
}

/** Every allow and block list off. */
const RESTRICTIONS = {
  allowlist: { enabled: false },
  blocklist: { enabled: false },
  allowlist_blocklist_disabled_on_sign_in: { enabled: false },
  block_email_subaddresses: { enabled: false },
  block_disposable_email_domains: { enabled: false },
}

/** The password rules of a new instance. */
const PASSWORD_SETTINGS = {
  disable_hibp: false,
  disable_password_reverification: false,
  min_length: 0,
  max_length: 0,
  require_special_char: false,
  require_numbers: false,
  require_uppercase: false,
  require_lowercase: false,
  show_zxcvbn: false,
  min_zxcvbn_strength: 0,
  enforce_hibp_on_sign_in: false,
  allowed_special_characters: "!\"#$%&'()*+,-./:;<=>?@[]^_`{|}~",
}

/** The sign-in, sign-up and password rules. */
function userSettings(instance: ClerkInstance) {
  return {
    attributes: attributes(instance),
    sign_in: { second_factor: { required: false } },
    sign_up: {
      captcha_enabled: false,
      captcha_widget_type: "smart",
      custom_action_required: false,
      progressive: true,
      mode: "public" as const,
      legal_consent_enabled: false,
      mfa: { required: false },
    },
    restrictions: RESTRICTIONS,
    username_settings: {
      min_length: 4,
      max_length: 64,
      allow_extended_special_characters: false,
      allow_numeric_usernames: false,
    },
    actions: { delete_self: true, create_organization: true, create_organizations_limit: null },
    attack_protection: {
      user_lockout: { enabled: true, max_attempts: 100, duration_in_minutes: 60 },
      pii: { enabled: false },
      email_link: { require_same_client: false },
      enumeration_protection: { enabled: false },
    },
    passkey_settings: {
      allow_autofill: true,
      show_sign_in_button: true,
      satisfies_second_factor: false,
    },
    social: {},
    password_settings: PASSWORD_SETTINGS,
    saml: { enabled: false },
    enterprise_sso: { enabled: false, self_serve_sso: true, self_serve_directory_sync: true },
  }
}

/** Organizations on, with no domain enrollment and no automatic creation. */
const ORGANIZATION_SETTINGS = {
  enabled: true,
  max_allowed_memberships: 5,
  actions: { admin_delete: true },
  domains: {
    enabled: false,
    enrollment_modes: ["manual_invitation", "automatic_invitation", "automatic_suggestion"],
    default_role: "org:member",
  },
  slug: { disabled: false },
  creator_role: "org:admin",
  organization_creation_defaults: {
    enabled: false,
    automatic_organization_creation: { enabled: false },
    detect_from_email_domain: { enabled: false },
    organization_name_template: { enabled: false, template: "" },
    fallback: { name: "" },
  },
}

/** Billing off: no plans, paid or free. */
const COMMERCE_SETTINGS = {
  billing: {
    enabled: false,
    has_paid_user_plans: false,
    has_paid_org_plans: false,
    free_trial_requires_payment_method: true,
    user: { enabled: false, has_paid_plans: false },
    organization: { enabled: false, has_paid_plans: false },
  },
}

/**
 * The instance's settings as `GET /v1/environment` answers them to the browser SDK: email sign-in
 * with a password (or an emailed code), sign-up open, organizations on, no social providers,
 * billing or captcha.
 */
export function environmentJson(instance: ClerkInstance) {
  return {
    auth_config: authConfig(instance),
    display_config: displayConfig(instance),
    user_settings: userSettings(instance),
    organization_settings: ORGANIZATION_SETTINGS,
    fraud_settings: { object: "fraud_settings", native: { device_attestation_mode: "disabled" } },
    commerce_settings: COMMERCE_SETTINGS,
    api_keys_settings: {
      enabled: false,
      user_api_keys_enabled: false,
      orgs_api_keys_enabled: false,
    },
    maintenance_mode: false,
    client_debug_mode: false,
    partitioned_cookies: false,
  } satisfies Pick<EnvironmentJSON, "maintenance_mode"> &
    Partial<Record<keyof EnvironmentJSON | "fraud_settings", unknown>>
}
