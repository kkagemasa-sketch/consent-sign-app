// Vercel Serverless Function: 署名済みPDFを担当者へメール送信
// 必要な環境変数（Vercelの Project Settings → Environment Variables で設定）:
//   SMTP_USER  : 送信元のGoogle Workspaceメール（例 you@housingfp.co.jp）
//   SMTP_PASS  : そのアカウントの「アプリパスワード」（16桁）
//   STAFF_JSON : 担当者の対応表（JSON）。例:
//                {"araki":{"name":"荒田 知美","email":"araki@housingfp.co.jp"},
//                 "kamakura":{"name":"鎌倉 景政","email":"kamakura@housingfp.co.jp"}}
const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ ok:false, error:'method-not-allowed' }); return; }
  try {
    const body = req.body || {};
    const { staffId, name, signedAt, pdfBase64 } = body;
    if (!pdfBase64) { res.status(400).json({ ok:false, error:'no-pdf' }); return; }

    const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
    if (!user || !pass) { res.status(500).json({ ok:false, error:'mail-not-configured' }); return; }

    let staff = {};
    try { staff = JSON.parse(process.env.STAFF_JSON || '{}'); } catch (e) {}
    const entry = staff[staffId];
    if (!entry || !entry.email) { res.status(400).json({ ok:false, error:'unknown-staff' }); return; }

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass }
    });

    const cust = (name || 'お客様');
    await transporter.sendMail({
      from: user,
      to: entry.email,
      subject: `【保険募集同意書】${cust} 様の署名が届きました`,
      text: `担当：${entry.name || staffId}\nお客様：${cust} 様\n受付日時：${signedAt || ''}\n\n署名済みの同意書（PDF）を添付します。\n（このメールは署名アプリから自動送信されています）`,
      attachments: [{
        filename: `保険募集同意書_${cust}.pdf`,
        content: Buffer.from(pdfBase64, 'base64'),
        contentType: 'application/pdf'
      }]
    });

    res.status(200).json({ ok:true });
  } catch (e) {
    res.status(500).json({ ok:false, error: String((e && e.message) || e) });
  }
};
