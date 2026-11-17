import * as mediasoup from "mediasoup";
import type { types as ms } from "mediasoup";
import type { Config } from "../config";

/** Audio only. One codec keeps negotiation trivial. */
export const MEDIA_CODECS: ms.RouterRtpCodecCapability[] = [
  { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
];

/**
 * Owns the single mediasoup worker. One WebRtcServer = one UDP + one TCP port for ALL transports,
 * so the firewall only needs a single port open.
 */
export class Media {
  private constructor(
    readonly worker: ms.Worker,
    readonly webRtcServer: ms.WebRtcServer,
  ) {}

  static async create(rtc: Config["rtc"]): Promise<Media> {
    const worker = await mediasoup.createWorker({ logLevel: "warn" });
    worker.on("died", (err) => {
      console.error("[mediasoup] worker died, exiting so the supervisor restarts us", err);
      process.exit(1);
    });

    const listenInfos: ms.TransportListenInfo[] = (["udp", "tcp"] as const).map((protocol) => ({
      protocol,
      ip: rtc.listenIp,
      announcedAddress: rtc.announcedIp,
      port: rtc.port,
    }));
    const webRtcServer = await worker.createWebRtcServer({ listenInfos });
    console.log(`[mediasoup] worker pid=${worker.pid} listening on ${rtc.listenIp}:${rtc.port} (announced ${rtc.announcedIp})`);
    return new Media(worker, webRtcServer);
  }

  async createRouter() {
    const router = await this.worker.createRouter({ mediaCodecs: MEDIA_CODECS });
    // powers the "who is talking" ring in the UI
    const levelObserver = await router.createAudioLevelObserver({
      maxEntries: 5,
      threshold: -70,
      interval: 800,
    });
    return { router, levelObserver };
  }

  createTransport(router: ms.Router): Promise<ms.WebRtcTransport> {
    return router.createWebRtcTransport({
      webRtcServer: this.webRtcServer,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });
  }

  close(): void {
    this.worker.close();
  }
}
