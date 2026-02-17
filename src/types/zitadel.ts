/**
 * Zitadel Management API TypeScript Types
 * Covers users, projects, apps, roles, grants, service accounts
 */

// ─── Shared ──────────────────────────────────────────────────────────────────

export interface ResourceDetails {
  sequence: string;
  creationDate: string;
  changeDate: string;
  resourceOwner: string;
}

export interface ListDetails {
  totalResult: string;
  processedSequence: string;
  timestamp: string;
}

export interface ZitadelError {
  code: number;
  message: string;
  details?: Array<{
    '@type': string;
    id?: string;
    message?: string;
  }>;
}

// ─── Users ───────────────────────────────────────────────────────────────────

export type UserState =
  | 'USER_STATE_UNSPECIFIED'
  | 'USER_STATE_ACTIVE'
  | 'USER_STATE_INACTIVE'
  | 'USER_STATE_DELETED'
  | 'USER_STATE_LOCKED'
  | 'USER_STATE_INITIAL';

export interface HumanProfile {
  givenName: string;
  familyName: string;
  nickName?: string;
  displayName?: string;
  preferredLanguage?: string;
  gender?: 'GENDER_UNSPECIFIED' | 'GENDER_FEMALE' | 'GENDER_MALE' | 'GENDER_DIVERSE';
  avatarUrl?: string;
}

export interface HumanEmail {
  email: string;
  isEmailVerified: boolean;
}

export interface HumanPhone {
  phone?: string;
  isPhoneVerified?: boolean;
}

export interface ZitadelUserDetails {
  userId: string;
  state: UserState;
  username: string;
  loginNames: string[];
  preferredLoginName: string;
  human?: {
    profile: HumanProfile;
    email: HumanEmail;
    phone?: HumanPhone;
    passwordChanged?: string;
  };
  details: ResourceDetails;
}

export interface ListUsersResponse {
  details: ListDetails;
  sortingColumn?: number;
  result: ZitadelUserDetails[];
}

export interface GetUserResponse {
  user: ZitadelUserDetails;
}

export interface CreateHumanUserRequest {
  profile: {
    givenName: string;
    familyName: string;
    nickName?: string;
    displayName?: string;
    preferredLanguage?: string;
  };
  email: {
    email: string;
    isVerified?: boolean;
  };
  phone?: {
    phone: string;
    isVerified?: boolean;
  };
  password?: {
    password: string;
    changeRequired?: boolean;
  };
}

export interface CreateUserResponse {
  userId: string;
  details: ResourceDetails;
}

// ─── Projects ────────────────────────────────────────────────────────────────

export interface ZitadelProject {
  id: string;
  name: string;
  state: 'PROJECT_STATE_ACTIVE' | 'PROJECT_STATE_INACTIVE';
  details: ResourceDetails;
  projectRoleAssertion?: boolean;
  projectRoleCheck?: boolean;
  hasProjectCheck?: boolean;
}

export interface ListProjectsResponse {
  details: ListDetails;
  result: ZitadelProject[];
}

export interface GetProjectResponse {
  project: ZitadelProject;
}

export interface CreateProjectRequest {
  name: string;
  projectRoleAssertion?: boolean;
  projectRoleCheck?: boolean;
  hasProjectCheck?: boolean;
}

export interface CreateProjectResponse {
  id: string;
  details: ResourceDetails;
}

// ─── Applications (OIDC) ────────────────────────────────────────────────────

export interface OIDCConfig {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  responseTypes: string[];
  grantTypes: string[];
  appType: string;
  authMethodType: string;
  postLogoutRedirectUris?: string[];
  devMode?: boolean;
  accessTokenRoleAssertion?: boolean;
  idTokenRoleAssertion?: boolean;
  idTokenUserinfoAssertion?: boolean;
}

export interface ZitadelApp {
  id: string;
  name: string;
  state: 'APP_STATE_ACTIVE' | 'APP_STATE_INACTIVE';
  details: ResourceDetails;
  oidcConfig?: OIDCConfig;
}

export interface ListAppsResponse {
  details: ListDetails;
  result: ZitadelApp[];
}

export interface GetAppResponse {
  app: ZitadelApp;
}

export interface CreateOIDCAppRequest {
  name: string;
  redirectUris: string[];
  responseTypes: string[];
  grantTypes: string[];
  appType: string;
  authMethodType: string;
  postLogoutRedirectUris?: string[];
  devMode?: boolean;
}

export interface CreateOIDCAppResponse {
  appId: string;
  details: ResourceDetails;
  clientId: string;
  clientSecret?: string;
}

export interface UpdateOIDCAppRequest {
  redirectUris?: string[];
  responseTypes?: string[];
  grantTypes?: string[];
  appType?: string;
  authMethodType?: string;
  postLogoutRedirectUris?: string[];
  devMode?: boolean;
}

// ─── Roles ───────────────────────────────────────────────────────────────────

export interface ProjectRole {
  key: string;
  displayName: string;
  group?: string;
}

export interface ListProjectRolesResponse {
  details: ListDetails;
  result: ProjectRole[];
}

export interface CreateProjectRoleRequest {
  roleKey: string;
  displayName: string;
  group?: string;
}

// ─── Grants ──────────────────────────────────────────────────────────────────

export interface UserGrant {
  id: string;
  details: ResourceDetails;
  userId: string;
  projectId: string;
  projectGrantId?: string;
  roleKeys: string[];
  state: 'USER_GRANT_STATE_ACTIVE' | 'USER_GRANT_STATE_INACTIVE';
}

export interface ListUserGrantsResponse {
  details: ListDetails;
  result: UserGrant[];
}

export interface CreateUserGrantResponse {
  userGrantId: string;
  details: ResourceDetails;
}

// ─── Service Accounts (Machine Users) ────────────────────────────────────────

export interface CreateMachineUserRequest {
  userName: string;
  name: string;
  description?: string;
  accessTokenType?: 'ACCESS_TOKEN_TYPE_BEARER' | 'ACCESS_TOKEN_TYPE_JWT';
}

export interface CreateMachineUserResponse {
  userId: string;
  details: ResourceDetails;
}

export interface MachineKeyDetails {
  id: string;
  details: ResourceDetails;
  type: string;
  expirationDate?: string;
}

export interface ListMachineKeysResponse {
  details: ListDetails;
  result: MachineKeyDetails[];
}

export interface CreateMachineKeyResponse {
  keyId: string;
  keyDetails: string; // JSON string — only available at creation time
  details: ResourceDetails;
}

// ─── Organizations ───────────────────────────────────────────────────────────

export interface ZitadelOrg {
  id: string;
  name: string;
  state: 'ORG_STATE_ACTIVE' | 'ORG_STATE_INACTIVE';
  details: ResourceDetails;
  primaryDomain?: string;
}

export interface GetOrgResponse {
  org: ZitadelOrg;
}

export interface ListOrgsResponse {
  details: ListDetails;
  result: ZitadelOrg[];
}
