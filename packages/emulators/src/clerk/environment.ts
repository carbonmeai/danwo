import type { EnvironmentJSON } from "@clerk/shared/types"

import type { ClerkInstance } from "./store.ts"

/** An identifier attribute: whether it is on, required, and how it is verified and used. */
function attribute(
  enabled: boolean,
  options: { required?: boolean; firstFactors?: string[]; verifications?: string[] } = {},
) {
  return {
    enabled,
    required: options.required ?? false,
    verifications: options.verifications ?? [],
    used_for_first_factor: (options.firstFactors ?? []).length > 0,
    first_factors: options.firstFactors ?? [],
    used_for_second_factor: false,
    second_factors: [],
    verify_at_sign_up: (options.verifications ?? []).length > 0,
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
    first_name: attribute(false),
    last_name: attribute(false),
    password: attribute(instance.password, { required: instance.password }),
    web3_wallet: attribute(false),
    authenticator_app: attribute(false),
    backup_code: attribute(false),
    passkey: attribute(false),
  }
}

/** The URLs the browser SDK sends people to, on the instance's Account Portal. */
function displayUrls(instance: ClerkInstance) {
  const portal = `https://${instance.accountsHost}`

  return {
    after_sign_in_url: `${portal}/default-redirect`,
    after_sign_out_all_url: `${portal}/sign-in`,
    after_sign_out_one_url: `${portal}/default-redirect`,
    after_sign_up_url: `${portal}/default-redirect`,
    after_switch_session_url: `${portal}/default-redirect`,
    home_url: `${portal}/default-redirect`,
    sign_in_url: `${portal}/sign-in`,
    sign_up_url: `${portal}/sign-up`,
    user_profile_url: `${portal}/user`,
    organization_profile_url: `${portal}/organization`,
    create_organization_url: `${portal}/create-organization`,
    after_leave_organization_url: `${portal}/default-redirect`,
    after_create_organization_url: `${portal}/default-redirect`,
    waitlist_url: `${portal}/waitlist`,
    after_join_waitlist_url: `${portal}/default-redirect`,
    terms_url: "",
    privacy_policy_url: "",
  }
}

/** The display settings: the instance's name, a plain theme, no captcha. */
function displayConfig(instance: ClerkInstance) {
  return {
    object: "display_config" as const,
    id: `display_config_${instance.slug}`,
    ...displayUrls(instance),
    application_name: instance.slug,
    branded: false,
    captcha_public_key: null,
    captcha_widget_type: null,
    captcha_public_key_invisible: null,
    captcha_provider: "turnstile" as const,
    captcha_oauth_bypass: null,
    instance_environment_type: "development",
    logo_image_url: "",
    favicon_image_url: "",
    preferred_sign_in_strategy: instance.password ? ("password" as const) : ("otp" as const),
    support_email: "",
    theme: {
      general: {
        color: "#6c47ff",
        background_color: "#ffffff",
        font_family: "",
        font_color: "#151515",
        label_font_weight: "600",
        padding: "1em",
        border_radius: "0.5em",
        box_shadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
      },
      buttons: { font_color: "#ffffff", font_family: "", font_weight: "600" },
      accounts: { background_color: "#ffffff" },
    },
    show_devmode_warning: true,
  }
}

/** The sign-in, sign-up and password rules. */
function userSettings(instance: ClerkInstance) {
  return {
    attributes: attributes(instance),
    actions: { delete_self: true, create_organization: true },
    social: {},
    enterprise_sso: { enabled: false, self_serve_sso: false, self_serve_directory_sync: false },
    sign_in: { second_factor: { required: false, enabled: false } },
    sign_up: {
      allowlist_only: false,
      progressive: true,
      captcha_enabled: false,
      mode: "public" as const,
      legal_consent_enabled: false,
    },
    password_settings: {
      allowed_special_characters: "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
      disable_hibp: true,
      min_length: 8,
      max_length: 72,
      require_special_char: false,
      require_numbers: false,
      require_uppercase: false,
      require_lowercase: false,
      show_zxcvbn: false,
      min_zxcvbn_strength: 0,
    },
    passkey_settings: { allow_autofill: false, show_sign_in_button: false },
    username_settings: { min_length: 4, max_length: 64 },
  }
}

/**
 * The instance's settings as `GET /v1/environment` answers them to the browser SDK: email sign-in
 * with a password (or an emailed code), sign-up open, organizations on, no social providers,
 * billing or captcha.
 */
export function environmentJson(instance: ClerkInstance) {
  return {
    object: "environment",
    id: `env_${instance.slug}`,
    auth_config: {
      object: "auth_config",
      id: `aac_${instance.slug}`,
      single_session_mode: true,
      claimed_at: null,
      reverification: false,
    },
    display_config: displayConfig(instance),
    user_settings: userSettings(instance),
    organization_settings: {
      enabled: true,
      max_allowed_memberships: 5,
      force_organization_selection: false,
      actions: { admin_delete: true },
      domains: { enabled: false, enrollment_modes: [], default_role: null },
      slug: { disabled: false },
      organization_creation_defaults: { enabled: false },
    },
    commerce_settings: {
      object: "commerce_settings",
      id: "",
      billing: {
        stripe_publishable_key: null,
        organization: { enabled: false, has_paid_plans: false },
        user: { enabled: false, has_paid_plans: false },
      },
    },
    api_keys_settings: {
      object: "api_keys_settings",
      id: "",
      user_api_keys_enabled: false,
      orgs_api_keys_enabled: false,
    },
    protect_config: { object: "protect_config", id: "" },
    maintenance_mode: false,
    client_debug_mode: false,
    partitioned_cookies: false,
  } satisfies Pick<EnvironmentJSON, "maintenance_mode"> & Record<keyof EnvironmentJSON, unknown>
}
