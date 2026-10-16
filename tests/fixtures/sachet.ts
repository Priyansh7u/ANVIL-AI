// Real samples captured from the public SACHET feed (copyright: public domain per the feed), trimmed.
export const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>All India: CAP Disaster Alert Feeds</title>
    <description>CAP Integrated Alert System Warning Updates</description>
    <link>https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml</link>
    <pubDate>Tue, 13 Oct 2026 11:02:00 GMT</pubDate>
    <item>
      <title>Moderate to Heavy Rain with Thunderstorm  Lightning (wind speed 50-60 kmph gusting to 70kmph) is very likely over Delhi.</title>
      <description/>
      <category>Met</category>
      <link>https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier=1791765435882022</link>
      <author>controlroom@ndma.gov.in (IMD New Delhi)</author>
      <guid isPermaLink="false">1791765435882022</guid>
      <pubDate>Mon, 12 Oct 2026 00:37:17 GMT</pubDate>
    </item>
    <item>
      <title>River Ganga at Patna Gandhighat in Patna district of Bihar continues to flow in above normal flood situation at 8:00 am today.</title>
      <description/>
      <category>Met</category>
      <link>https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier=1791865300291016</link>
      <author>controlroom@ndma.gov.in (CWC)</author>
      <guid isPermaLink="false">1791865300291016</guid>
      <pubDate>Tue, 13 Oct 2026 04:21:42 GMT</pubDate>
    </item>
    <item>
      <title></title>
      <link>https://sachet.ndma.gov.in/x</link>
    </item>
  </channel>
</rss>`;

export const CAP_SAMPLE = `<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
<cap:identifier>IN-1791765435882022_48</cap:identifier>
<cap:sender>IMD-New-Delhi</cap:sender>
<cap:sent>2026-10-12T06:06:55+05:30</cap:sent>
<cap:status>Actual</cap:status>
<cap:msgType>Alert</cap:msgType>
<cap:scope>Public</cap:scope>
<cap:restriction/>
<cap:info>
<cap:language>en-IN</cap:language>
<cap:category>Met</cap:category>
<cap:event>Heavy Rain</cap:event>
<cap:urgency>Immediate</cap:urgency>
<cap:severity>Extreme</cap:severity>
<cap:certainty>Likely</cap:certainty>
<cap:effective>2026-10-12T06:05:00+05:30</cap:effective>
<cap:onset>2026-10-12T06:07:15+05:30</cap:onset>
<cap:expires>2026-10-12T08:05:00+05:30</cap:expires>
<cap:headline>Moderate to Heavy Rain with Thunderstorm  Lightning (wind speed 50-60 kmph gusting to 70kmph) is very likely over Delhi.</cap:headline>
<cap:description/>
<cap:instruction>Please follow SDMA guidelines.</cap:instruction>
<cap:area>
<cap:areaDesc>Central, East, New Delhi, North, North East, North West, Shahdara, South, South East, South West, West districts of Delhi</cap:areaDesc>
<cap:geocode>
<cap:valueName>LGD District Code</cap:valueName>
<cap:value>83</cap:value>
</cap:geocode>
</cap:area>
</cap:info>
</cap:alert>`;
