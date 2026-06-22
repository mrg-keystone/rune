import "#reflect-metadata";
import { assertEquals } from "#assert";
import { IsInt, IsOptional, IsString } from "class-validator";
import { bootstrapServer } from "./mod.ts";
import {
  Endpoint,
  EndpointController,
  endpointModule,
} from "@foundation/domain/business/endpoint-decorator/mod.ts";

class ProbeQueryDto {
  @IsString()
  tableName!: string;
  @IsOptional()
  @IsInt()
  limit?: number;
}
class ProbeOutDto {
  @IsInt()
  n!: number;
}

@EndpointController("probe")
class ProbeController {
  @Endpoint({ input: ProbeQueryDto, output: ProbeOutDto, order: 1 })
  go(_body: ProbeQueryDto): ProbeOutDto {
    return { n: 1 };
  }
}

Deno.test("served OpenAPI honors class-validator @IsOptional in required", async () => {
  const api = await bootstrapServer(
    "probe-app",
    endpointModule("Probe", [ProbeController]),
  );
  try {
    // the /json endpoint is self-gated on the socket peer — forward loopback
    // conn info like a real localhost caller (in-process fetch fails closed)
    const loopback = {
      remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 },
    };
    const res = await api.handler(
      new Request("http://app/docs/probe/json"),
      // deno-lint-ignore no-explicit-any
      loopback as any,
    );
    assertEquals(res.status, 200);
    const doc = await res.json();
    assertEquals(
      doc.components.schemas.ProbeQueryDto.required,
      ["tableName"],
    );
  } finally {
    await api.stop();
  }
});
