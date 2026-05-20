const { Resolver } = require('dns').promises;
const resolver = new Resolver();
// Use Google and Cloudflare DNS
resolver.setServers(['8.8.8.8', '1.1.1.1']);

async function checkDNS() {
  const domain = 'dripstreetshop.com';
  const subDomain = 'send.dripstreetshop.com';
  
  console.log(`🔍 Starting DNS Diagnostics for ${domain} using Public DNS resolvers...\n`);

  // 1. Check SPF on subdomain
  try {
    const txtRecords = await resolver.resolveTxt(subDomain);
    console.log(`✅ Subdomain (${subDomain}) TXT records found:`);
    txtRecords.forEach(rec => console.log(`   - ${rec.join(' ')}`));
  } catch (err) {
    console.log(`❌ Failed to resolve TXT/SPF records for ${subDomain}: ${err.message}`);
  }

  // 2. Check SPF on root
  try {
    const txtRecords = await resolver.resolveTxt(domain);
    console.log(`\n✅ Root domain (${domain}) TXT records found:`);
    txtRecords.forEach(rec => console.log(`   - ${rec.join(' ')}`));
  } catch (err) {
    console.log(`❌ Failed to resolve TXT/SPF records for ${domain}: ${err.message}`);
  }

  // 3. Check DKIM on resend._domainkey.dripstreetshop.com
  try {
    const dkimRoot = `resend._domainkey.${domain}`;
    const txtRecords = await resolver.resolveTxt(dkimRoot);
    console.log(`\n✅ DKIM record for root (${dkimRoot}) found:`);
    txtRecords.forEach(rec => console.log(`   - ${rec.join(' ')}`));
  } catch (err) {
    console.log(`❌ Failed to resolve DKIM record for resend._domainkey.${domain}: ${err.message}`);
  }

  // 4. Check DKIM on resend._domainkey.send.dripstreetshop.com
  try {
    const dkimSub = `resend._domainkey.${subDomain}`;
    const txtRecords = await resolver.resolveTxt(dkimSub);
    console.log(`\n✅ DKIM record for subdomain (${dkimSub}) found:`);
    txtRecords.forEach(rec => console.log(`   - ${rec.join(' ')}`));
  } catch (err) {
    console.log(`❌ Failed to resolve DKIM record for resend._domainkey.${subDomain}: ${err.message}`);
  }

  // 5. Check DMARC
  try {
    const dmarcDomain = `_dmarc.${domain}`;
    const txtRecords = await resolver.resolveTxt(dmarcDomain);
    console.log(`\n✅ DMARC record (${dmarcDomain}) found:`);
    txtRecords.forEach(rec => console.log(`   - ${rec.join(' ')}`));
  } catch (err) {
    console.log(`❌ Failed to resolve DMARC record for _dmarc.${domain}: ${err.message}`);
  }

  // 6. Check MX records on subdomain
  try {
    const mxRecords = await resolver.resolveMx(subDomain);
    console.log(`\n✅ MX records for ${subDomain} found:`);
    mxRecords.forEach(rec => console.log(`   - Exchange: ${rec.exchange}, Priority: ${rec.priority}`));
  } catch (err) {
    console.log(`❌ Failed to resolve MX records for ${subDomain}: ${err.message}`);
  }
}

checkDNS().catch(console.error);
