# Hiplingo frontend documentation

This directory owns the public `hiplingo.com` frontend lifecycle.

## Authoritative document

### `hiplingo.com-production-deployment-workflow.txt`

Covers:

- local source `~/Desktop/record-label/hiplingo.com/`;
- `npm run build`;
- Vite `dist/` deployment source;
- immutable timestamped frontend releases;
- `app/current` atomic promotion;
- 0755/0644 public mode contract;
- validation and rollback;
- strict separation from persistent public media.

## Deployment boundary

Frontend production:

```text
/var/www/hiplingo.com/app/releases/<timestamp>/
/var/www/hiplingo.com/app/current
```

Persistent media:

```text
/var/www/hiplingo.com/published-media/
```

A frontend deploy or rollback must never modify `published-media`.

## Related documentation

Shared server infrastructure:

```text
~/Desktop/websites/nathanbrenton.com/docs/
web-prod-01-production-rebuild-runbook-20260824-alerting-v1.txt
```

Publication/public-media deployment:

```text
~/Desktop/record-label/metadata-editor/docs/
DEPLOYMENT-GUIDE.md
web-prod-01-hiplingo-media-deployment-runbook-20260818.txt
```
