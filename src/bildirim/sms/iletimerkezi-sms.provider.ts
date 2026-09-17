import { Injectable, Logger } from "@nestjs/common";
import { SmsProvider } from "./sms-provider.interface";
import { telefonMaskele } from "../../common/pii/telefon-maskele";

// YALNIZ METADATA LOGLANIR: saglayici yanit govdesi ham yazilmaz (mesaj metnini
// ya da numarayi geri yansitma ihtimaline karsi). Durum mesaji saglayicinin sabit
// hata metnidir ve teshis icin gerekli (orn. gonderici adi onaysiz); icindeki uzun
// rakam dizileri yine de gizlenir. Hata yutma davranisi DEGISMEDI (F2 ayri is).
function guvenliMesaj(s: string): string {
  return s.replace(/\d{7,}/g, "[numara]").slice(0, 200);
}

@Injectable()
export class IletiMerkeziSmsProvider implements SmsProvider {
  private readonly logger = new Logger("SMS");
  private readonly key = process.env.ILETIMERKEZI_KEY || "";
  private readonly hash = process.env.ILETIMERKEZI_HASH || "";
  private readonly sender = process.env.ILETIMERKEZI_SENDER || "APITEST";

  private normalize(phone: string): string {
    let p = (phone || "").replace(/[^0-9]/g, "");
    if (p.startsWith("90")) return p;
    if (p.startsWith("0")) return "9" + p;
    if (p.length === 10) return "90" + p;
    return p;
  }

  async send(phone: string, message: string): Promise<void> {
    const numara = this.normalize(phone);
    const body = {
      request: {
        authentication: { key: this.key, hash: this.hash },
        order: {
          sender: this.sender,
          iys: "0",
          message: { text: message, receipents: { number: [numara] } },
        },
      },
    };
    try {
      const res = await fetch("https://api.iletimerkezi.com/v1/send-sms/json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const txt = await res.text();
      if (!res.ok) {
        this.logger.error(`Ileti Merkezi SMS HTTP hata (${res.status}) -> ${telefonMaskele(numara)}, yanit ${txt.length} karakter`);
        return;
      }
      // HTTP 200 gelse bile govdedeki status.code 200 degilse gonderim BASARISIZ.
      let code = "";
      let mesaj = "";
      let orderId = "";
      try {
        const j = JSON.parse(txt);
        code = String(j?.response?.status?.code ?? "");
        mesaj = String(j?.response?.status?.message ?? "");
        orderId = String(j?.response?.order?.id ?? "");
      } catch {
        this.logger.error(`Ileti Merkezi SMS yaniti ayristirilamadi -> ${telefonMaskele(numara)}, yanit ${txt.length} karakter`);
        return;
      }
      if (code !== "200") {
        this.logger.error(`Ileti Merkezi SMS reddedildi (code=${guvenliMesaj(code)}) -> ${telefonMaskele(numara)}: ${guvenliMesaj(mesaj)}`);
        return;
      }
      this.logger.log(`SMS gonderildi -> ${telefonMaskele(numara)} (orderId=${orderId})`);
    } catch (e: any) {
      this.logger.error(`Ileti Merkezi SMS istisna: ${e?.message || e}`);
    }
  }
}
