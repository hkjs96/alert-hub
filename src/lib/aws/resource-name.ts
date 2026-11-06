// 리소스 표시 이름 — CloudWatch 알람에는 차원(InstanceId=i-…, LoadBalancer=app/x/123 …)만 온다.
// 차원에서 리소스 ARN 을 만들고, 그 리소스의 Name 태그를 조회해 사람이 읽는 이름을 붙인다.

function dims(resource: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of resource.split(",")) {
    const i = part.indexOf("=");
    if (i > 0) m.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return m;
}

/**
 * 차원 문자열 → 태그를 물어볼 리소스 ARN. 모르는 유형이면 null.
 * 순서가 곧 우선순위(한 알람에 차원이 여럿이면 가장 구체적인 것).
 */
export function resourceArnOf(
  resource: string | null | undefined,
  region: string | null | undefined,
  accountId: string | null | undefined,
): string | null {
  if (!resource || !region || !accountId) return null;
  const d = dims(resource);
  const p = (svc: string, rest: string) => `arn:aws:${svc}:${region}:${accountId}:${rest}`;
  const v = (k: string) => d.get(k);
  if (v("InstanceId")?.startsWith("i-")) return p("ec2", `instance/${v("InstanceId")}`);
  if (v("VolumeId")) return p("ec2", `volume/${v("VolumeId")}`);
  if (v("NatGatewayId")) return p("ec2", `natgateway/${v("NatGatewayId")}`);
  if (v("TargetGroup")) return p("elasticloadbalancing", v("TargetGroup")!);
  if (v("LoadBalancer")) return p("elasticloadbalancing", `loadbalancer/${v("LoadBalancer")}`);
  if (v("DBInstanceIdentifier")) return p("rds", `db:${v("DBInstanceIdentifier")}`);
  if (v("DBClusterIdentifier")) return p("rds", `cluster:${v("DBClusterIdentifier")}`);
  if (v("CacheClusterId")) return p("elasticache", `cluster:${v("CacheClusterId")}`);
  if (v("FunctionName")) return p("lambda", `function:${v("FunctionName")}`);
  if (v("ClusterName") && v("ServiceName")) return p("ecs", `service/${v("ClusterName")}/${v("ServiceName")}`);
  if (v("ClusterName")) return p("ecs", `cluster/${v("ClusterName")}`);
  if (v("TableName")) return p("dynamodb", `table/${v("TableName")}`);
  if (v("QueueName")) return p("sqs", v("QueueName")!);
  if (v("TopicName")) return p("sns", v("TopicName")!);
  if (v("BucketName")) return `arn:aws:s3:::${v("BucketName")}`;
  if (v("ApiName")) return null; // API Gateway 는 이름이 이미 차원에 있다
  return null;
}

/** 차원 값들(식별자). Name 태그가 이 중 하나와 같으면 굳이 덧붙이지 않는다. */
export function identifiersOf(resource: string): string[] {
  return [...dims(resource).values()];
}

/** 화면 표시: Name 이 있으면 "Name (원래 리소스)". */
export function displayResource(resource: string, name: string | null | undefined): string {
  return name ? `${name} (${resource})` : resource;
}
