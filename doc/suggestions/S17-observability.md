# S17: 可观测性集成 (OpenTelemetry)

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.3 长期改进

**优先级**: L4（架构级）  
**涉及文件**: `instrumentation.ts`, 新建 `src/lib/telemetry.ts`  
**预估工时**: 10h

---

## 原因

### 当前行为

系统没有任何可观测性工具：

- **无 Tracing**：无法追踪一个采集请求从 API → runner → fetcher → LLM 的完整链路
- **无 Metrics**：不知道采集耗时分布、LLM 调用延迟 P50/P99、错误率
- **无告警**：采集连续失败不会通知运维人员
- **日志无聚合**：Docker 日志分散在各个容器中
- **排查困难**：出现问题时只能凭经验猜测瓶颈

### 设计目标

集成 OpenTelemetry，通过标准化协议导出 traces 和 metrics，支持与 Jaeger/Grafana/Prometheus 等后端集成。

---

## 详细修改步骤

### 步骤 1：安装依赖

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/sdk-metrics \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

### 步骤 2：创建 OpenTelemetry 配置

新建 `src/lib/telemetry.ts`：

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

let sdk: NodeSDK | null = null;

export function initTelemetry() {
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!otlpEndpoint) {
    console.log("[telemetry] 未配置 OTLP 端点，跳过可观测性初始化");
    return;
  }

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: "tech-info-collector",
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.1.0",
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  });

  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${otlpEndpoint}/v1/metrics`,
    }),
    exportIntervalMillis: 15000,
  });

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": { enabled: true },
        "@opentelemetry/instrumentation-fs": { enabled: false }, // 减少噪音
      }),
    ],
  });

  sdk.start();
  console.log("[telemetry] OpenTelemetry 初始化完成");
}

export async function shutdownTelemetry() {
  if (sdk) {
    await sdk.shutdown();
    console.log("[telemetry] OpenTelemetry 已关闭");
  }
}
```

### 步骤 3：在 instrumentation hook 中初始化

```typescript
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initTelemetry } = await import("./src/lib/telemetry");
    initTelemetry();
    
    const { startScheduler } = await import("./src/scheduler/cron");
    startScheduler();
  }
}
```

### 步骤 4：添加自定义 Span

在关键位置添加自定义 span 以追踪业务逻辑：

```typescript
// src/pipeline/runner.ts
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("tech-info-collector");

export async function runSite(site: Site, ...): Promise<RunResult> {
  return tracer.startActiveSpan("runSite", async (span) => {
    span.setAttributes({
      "site.id": site.id,
      "site.name": site.name,
      "site.render": site.render,
      "site.urls_count": site.urls.length,
    });

    try {
      const result = await runSiteInternal(site, ...);
      span.setAttributes({
        "result.fetched": result.fetched,
        "result.status": result.status,
        "result.errors": result.errorCount,
      });
      return result;
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw e;
    } finally {
      span.end();
    }
  });
}
```

```typescript
// src/ai/sandbox.ts
export async function reviewArticle(input: {...}): Promise<ReviewResult> {
  return tracer.startActiveSpan("ai.reviewArticle", async (span) => {
    span.setAttributes({
      "ai.model": process.env.AI_MODEL!,
      "input.body_length": input.body.length,
    });

    const startTime = Date.now();
    try {
      const result = await reviewArticleInternal(input);
      span.setAttributes({
        "result.quality_score": result.qualityScore,
        "result.usable": result.usable,
        "result.tokens": result.tokens,
        "ai.duration_ms": Date.now() - startTime,
      });
      return result;
    } catch (e) {
      span.recordException(e as Error);
      throw e;
    } finally {
      span.end();
    }
  });
}
```

### 步骤 5：添加自定义 Metrics

```typescript
// src/lib/metrics.ts
import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("tech-info-collector");

/** 采集文章计数器 */
export const crawlCounter = meter.createCounter("crawl.articles_total", {
  description: "Total number of articles crawled",
});

/** 采集耗时直方图 */
export const crawlDuration = meter.createHistogram("crawl.duration_ms", {
  description: "Crawl duration per site in milliseconds",
  unit: "ms",
});

/** AI 审核耗时直方图 */
export const aiReviewDuration = meter.createHistogram("ai.review_duration_ms", {
  description: "AI review duration per article",
  unit: "ms",
});

/** 采集错误计数器 */
export const crawlErrors = meter.createCounter("crawl.errors_total", {
  description: "Total crawl errors",
});
```

### 步骤 6：在业务代码中记录 Metrics

```typescript
// 采集完成后
crawlCounter.add(result.fetched, { site: site.name, status: result.status });
crawlDuration.record(durationMs, { site: site.name });
if (result.errorCount > 0) crawlErrors.add(result.errorCount, { site: site.name });
```

### 步骤 7：添加 docker-compose 中的可观测性服务

```yaml
services:
  # 可选：Jaeger（tracing UI）
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"  # UI
      - "4318:4318"    # OTLP HTTP
    environment:
      - COLLECTOR_OTLP_ENABLED=true
    volumes:
      - jaeger_data:/tmp

  # 可选：Prometheus（metrics）
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
```

### 步骤 8：环境变量配置

```bash
# .env
# OpenTelemetry
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318  # 开发环境
# 生产环境可指向 Grafana Cloud / Datadog / 自建 Collector
OTEL_SERVICE_NAME=tech-info-collector
OTEL_LOG_LEVEL=info
```

### 步骤 9：验证

1. 启动 Jaeger → http://localhost:16686 查看 traces
2. 触发采集 → 在 Jaeger 中看到完整的 trace 链路
3. 查看 AI 审核耗时的 P50/P99
4. 查看错误率

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 可观测性 | 从"黑盒"变为可追踪、可度量 |
| 性能开销 | OTel SDK 约 <5% 额外 CPU（自动检测） |
| 新依赖 | OpenTelemetry SDK（~1MB） |
| 部署 | 可选 Jaeger/Prometheus 容器 |
