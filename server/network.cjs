// Use the operating system's normal certificate trust store, including the
// enterprise and intermediate certificates available to Windows browsers.
// Certificate verification stays enabled for every HTTPS connection.
require('node:dns').setDefaultResultOrder('ipv4first');
const tls=require('node:tls');
if(typeof tls.setDefaultCACertificates==='function'){
 tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'),...tls.getCACertificates('system')])]);
}
