---
title: Privacy Policy
version: 1.0
lang: en
---
# Privacy Policy

**The operator of this site has not published its own privacy policy here yet.** This page is the default text that comes with the libreSRS software. Whoever runs this site (the "operator") is responsible for its privacy policy: what it collects and why, who receives it, where it is stored, how long it is kept, and how to reach the operator. The operator should publish its own policy on this page. Until it does, this page states only what the libreSRS software itself does as it is distributed, and what this site's settings show right now. It makes no promise on the operator's behalf.

**Contents.** [Who runs this site](#who) · [The software](#software) · [AI features](#AI-Policy) · [Extensions](#instance) · [Security](#security) · [Changes](#changes)

---

## Who runs this site {#who}

{{?service_domain|- **Site:** {{service_domain}}}}
- **Operator:** {{operator_legal_name}}{{?operator_short_name|, doing business as {{operator_short_name}}}}
- **Contact:** {{support_email}}
- **Privacy questions:** {{privacy_email}}
- **Postal address:** {{operator_postal_address}}
- **Telephone:** {{operator_phone}}

## The software {#software}

libreSRS is free software under the GNU Affero General Public License v3.0 or later. The version running here is shown at [/api/build-info](/api/build-info). {{?source_url|Its source code is published at [{{source_url}}]({{source_url}}).}}

As it comes, the software:

- has no advertising, analytics or tracking built in, and its pages load scripts only from this site;
- stores the API keys and sign-in secrets saved in the administrator's settings encrypted in the site's database;
- sends data to an AI provider only through the AI features below, and only while the administrator has switched them on.

## AI features on this site {#AI-Policy #ai}

The administrator switches each AI feature on or off in the AI settings. The table below is read from those settings each time this page is loaded.

{{?ai_no_student_data|**With these settings, no AI feature that sends student data is on.** Any feature that is on sends only the text named in the table, with nothing about who asked.}}
{{?ai_student_audio|**With these settings, one AI feature sends student data: the voice recording in the "repeat the sentence" test**, with no name, email, ID or other identifier, to be transcribed. The other features send only the text named in the table.}}
{{?ai_settings_unknown|**This site's AI settings could not be read when this page was made**, so this page says nothing about which AI features are on. Reload it to see them.}}

{{ai_features_table}}

## Extensions on this site {#instance}

{{!extension_disclosures|No extension running on this site describes a data flow of its own.}}
{{extension_disclosures}}

## Security {#security}

Security reports: {{security_email}}. {{security_txt_statement}}

## Changes {#changes}

The operator publishes its own policy, and any change to it, on this page.

{{?privacy_prior_versions|<caption>Earlier versions of this page.</caption>}}

{{?privacy_prior_versions|| Version | Effective | Full text | What changed |}}
{{?privacy_prior_versions||---|---|---|---|}}
{{?privacy_prior_versions|{{privacy_prior_versions}}}}
