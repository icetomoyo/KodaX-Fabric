export const INITIAL_PASSWORD_DINGTALK_REQUIRED = "INITIAL_PASSWORD_DINGTALK_REQUIRED";
export const MUST_CHANGE_PASSWORD = "MUST_CHANGE_PASSWORD";

export const INITIAL_PASSWORD_DINGTALK_MESSAGE = "初始密码需先通过钉钉认证后再修改";
export const MUST_CHANGE_PASSWORD_MESSAGE = "请先修改初始密码";

export function isAllowedDuringForcedPasswordChange(url: string): boolean {
  const path = url.split("?")[0];
  return path === "/api/auth/me" || path === "/api/auth/change-password";
}
