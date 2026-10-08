//! BOOTH description links are unconfirmed relationship clues, not compatibility verdicts.
use scraper::{Html, Selector};
use std::collections::HashSet;
use vua_bdl_store::{
    BdlStore, BdlStoreError, DependencyResolutionEvidence, NewDependencyObservation,
};

/// The source product must already be recorded. Only the supplied author-description
/// snapshot is inspected; no page fetching or automatic dependency acquisition occurs.
pub fn record_description_dependencies(
    store: &BdlStore,
    html: &str,
    source_product_id: &str,
    page_hash: &str,
    observed_at: &str,
) -> Result<(), BdlStoreError> {
    let document = Html::parse_document(html);
    let links =
        Selector::parse("#items article .js-market-item-detail-description.description a[href]")
            .expect("static description selector");
    let mut seen = HashSet::new();
    for link in document.select(&links) {
        let href = link.value().attr("href").expect("selected link has href");
        let Some(target_product_id) = booth_product_id(href) else {
            continue;
        };
        let text = link.text().collect::<Vec<_>>().join(" ");
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.is_empty()
            || target_product_id == source_product_id
            || !seen.insert(target_product_id.clone())
        {
            continue;
        }
        let lowered = text.to_lowercase();
        let dep_kind = if lowered.contains("shader")
            || lowered.contains("シェーダー")
            || lowered.contains("liltoon")
            || lowered.contains("poiyomi")
        {
            "shader"
        } else {
            "other"
        };
        let in_catalog = store.catalog_detail(&target_product_id)?.is_some();
        let evidence = if in_catalog {
            vec![DependencyResolutionEvidence {
                link_text: text.clone(),
                link_url: href.to_owned(),
                span: "description_link".to_owned(),
                note: None,
            }]
        } else {
            Vec::new()
        };
        store.record_dependency_observation(&NewDependencyObservation {
            product_id: source_product_id.to_owned(),
            dep_kind: dep_kind.to_owned(),
            dep_name: text,
            raw_quote: href.to_owned(),
            source_span: "description_link".to_owned(),
            version_hint: None,
            resolved_ref_product_id: in_catalog.then_some(target_product_id),
            resolution_evidence: evidence,
            extraction_method: "link".to_owned(),
            extracted_by: "catalog-sync/0.2-description-links-v2".to_owned(),
            observed_at: observed_at.to_owned(),
            processor_version: "catalog-sync/0.2-description-links-v2".to_owned(),
            content_hash: Some(page_hash.to_owned()),
            run_id: None,
        })?;
    }
    Ok(())
}

fn booth_product_id(href: &str) -> Option<String> {
    let (host, path) = href.strip_prefix("https://")?.split_once('/')?;
    if host.contains(['@', ':']) || !(host == "booth.pm" || host.ends_with(".booth.pm")) {
        return None;
    }
    let path = path.split(['?', '#']).next()?;
    let mut segments = path.split('/');
    let first = segments.next()?;
    if first != "items" && segments.next()? != "items" {
        return None;
    }
    let native_id = segments.next()?;
    if native_id.is_empty()
        || !native_id.bytes().all(|byte| byte.is_ascii_digit())
        || native_id.parse::<u64>().ok()? == 0
        || segments.any(|part| !part.is_empty())
    {
        return None;
    }
    Some(format!("booth:{native_id}"))
}
