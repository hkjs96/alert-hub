// 리소스 표시 이름 — CloudWatch 알람에는 EC2 인스턴스 ID 만 오므로 Name 태그를 따로 조회해 붙인다.

/** "InstanceId=i-0abc…" 등에서 EC2 인스턴스 ID 를 꺼낸다. 없으면 null. */
export function ec2InstanceIdOf(resource: string | null | undefined): string | null {
  if (!resource) return null;
  const m = /\bi-[0-9a-f]{8,17}\b/.exec(resource);
  return m ? m[0] : null;
}

/** Slack·화면 표시: Name 이 있으면 "Name (원래 리소스)". */
export function displayResource(resource: string, name: string | null | undefined): string {
  return name ? `${name} (${resource})` : resource;
}
