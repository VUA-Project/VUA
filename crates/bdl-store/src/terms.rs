//! IN-2 terms evidence. Existing catalog read faces are independent of these tables.
use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TermsLink {
    pub source_id: String,
    pub source_kind: String,
    pub source_url: String,
    pub google_file_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TermWarning {
    pub code: String,
    pub item: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TermItem {
    pub item: String,
    pub term_key: String,
    pub value: String,
    pub condition: Option<String>,
    pub raw_text: String,
    pub summary_raw_text: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TermsDocument {
    pub sha256: String,
    pub parser_version: String,
    pub status: String,
    pub generator_version: Option<String>,
    pub vn3_version: Option<String>,
    pub language: Option<String>,
    pub content_title: Option<String>,
    pub licensor: Option<String>,
    pub credit_notation: Option<String>,
    pub hashtags: Vec<String>,
    pub agreement_version: Option<String>,
    pub special_note: Option<String>,
    pub warnings: Vec<TermWarning>,
    pub items: Vec<TermItem>,
}

impl TermsDocument {
    pub fn empty(status: &str, sha256: &str, parser_version: &str, problem: &str) -> Self {
        Self {
            sha256: sha256.into(),
            parser_version: parser_version.into(),
            status: status.into(),
            generator_version: None,
            vn3_version: None,
            language: None,
            content_title: None,
            licensor: None,
            credit_notation: None,
            hashtags: Vec::new(),
            agreement_version: None,
            special_note: None,
            warnings: vec![TermWarning {
                code: problem.into(),
                item: None,
            }],
            items: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TermsSource {
    #[serde(flatten)]
    pub link: TermsLink,
    pub status: String,
    pub fetched_at: Option<String>,
    pub problem: Option<String>,
    pub document: Option<TermsDocument>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductTerms {
    pub schema_version: String,
    pub product_id: String,
    pub state: String,
    pub observed_at: Option<String>,
    pub capture_problem: Option<String>,
    pub sources: Vec<TermsSource>,
}

impl ProductTerms {
    pub fn not_observed(product_id: impl Into<String>) -> Self {
        Self {
            schema_version: "0.1".into(),
            product_id: product_id.into(),
            state: "not_observed".into(),
            observed_at: None,
            capture_problem: None,
            sources: Vec::new(),
        }
    }
}

fn compute_product_terms_state<'a>(
    observed_at: Option<&str>,
    capture_problem: Option<&str>,
    sources: &'a [TermsSource],
) -> &'a str {
    let downloadable: Vec<_> = sources
        .iter()
        .filter(|s| s.link.google_file_id.is_some())
        .collect();
    if capture_problem.is_some() {
        "unsupported"
    } else if observed_at.is_none() {
        "not_observed"
    } else if downloadable.is_empty() {
        if sources.is_empty() {
            "no_vn3"
        } else {
            "link_only"
        }
    } else if downloadable.iter().all(|s| s.status == "parsed") {
        "parsed"
    } else if downloadable.iter().any(|s| s.status == "parsed") {
        "partial"
    } else if downloadable
        .iter()
        .all(|s| s.status == downloadable[0].status)
    {
        &downloadable[0].status
    } else {
        "partial"
    }
}

#[derive(Clone, Debug)]
pub struct TermsProduct {
    pub product_id: String,
    pub description: Option<String>,
}

fn stored_document(
    connection: &Connection,
    source: &str,
    sha: &str,
    parser: &str,
) -> Result<Option<TermsDocument>, BdlStoreError> {
    let document = connection.query_row(
        "SELECT status,generator_version,vn3_version,language,content_title,licensor,credit_notation,hashtags,agreement_version,special_note,warnings FROM vn3_documents WHERE source_id=?1 AND sha256=?2 AND parser_version=?3",
        params![source,sha,parser], |row| Ok((row.get::<_,String>(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?,row.get::<_,String>(7)?,row.get(8)?,row.get(9)?,row.get::<_,String>(10)?)),
    ).optional()?;
    let Some((
        status,
        generator_version,
        vn3_version,
        language,
        content_title,
        licensor,
        credit_notation,
        hashtags,
        agreement_version,
        special_note,
        warnings,
    )) = document
    else {
        return Ok(None);
    };
    let mut query = connection.prepare("SELECT item,term_key,value,condition,raw_text,summary_raw_text FROM vn3_document_items WHERE source_id=?1 AND sha256=?2 AND parser_version=?3 ORDER BY item")?;
    let items = query
        .query_map(params![source, sha, parser], |row| {
            Ok(TermItem {
                item: row.get(0)?,
                term_key: row.get(1)?,
                value: row.get(2)?,
                condition: row.get(3)?,
                raw_text: row.get(4)?,
                summary_raw_text: row.get(5)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(Some(TermsDocument {
        sha256: sha.into(),
        parser_version: parser.into(),
        status,
        generator_version,
        vn3_version,
        language,
        content_title,
        licensor,
        credit_notation,
        hashtags: serde_json::from_str(&hashtags)?,
        agreement_version,
        special_note,
        warnings: serde_json::from_str(&warnings)?,
        items,
    }))
}

impl BdlStore {
    pub fn terms_product(&self, product: &str) -> Result<Option<TermsProduct>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        Ok(connection
            .query_row(
                "SELECT product_id,description FROM products WHERE product_id=?1",
                [product],
                |row| {
                    Ok(TermsProduct {
                        product_id: row.get(0)?,
                        description: row.get(1)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn terms_library_products(&self) -> Result<Vec<TermsProduct>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let mut query = connection.prepare("SELECT p.product_id,p.description FROM products p WHERE p.status='complete' AND (p.library_type IS NOT NULL OR EXISTS(SELECT 1 FROM artifact_mappings a WHERE a.product_id=p.product_id)) AND NOT EXISTS(SELECT 1 FROM removed_library_cards r WHERE r.kind='product' AND r.target_id=p.product_id) ORDER BY p.product_id")?;
        let rows = query
            .query_map([], |row| {
                Ok(TermsProduct {
                    product_id: row.get(0)?,
                    description: row.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    }

    /// A captured empty description is evidence; missing markup must not call this method.
    pub fn record_terms_links(
        &self,
        product: &str,
        links: &[TermsLink],
        observed: &str,
    ) -> Result<(), BdlStoreError> {
        self.record_terms_links_inner(product, links, observed, false)
    }
    pub fn record_terms_links_if_missing(
        &self,
        product: &str,
        links: &[TermsLink],
        observed: &str,
    ) -> Result<(), BdlStoreError> {
        self.record_terms_links_inner(product, links, observed, true)
    }
    fn record_terms_links_inner(
        &self,
        product: &str,
        links: &[TermsLink],
        observed: &str,
        missing_only: bool,
    ) -> Result<(), BdlStoreError> {
        if links.iter().any(|l| {
            !["drive", "docs", "vn3", "link"].contains(&l.source_kind.as_str())
                || l.source_url.len() > 4096
                || l.source_id.len() > 256
        }) {
            return Err(BdlStoreError::InvalidObservation("terms links"));
        }
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if missing_only
            && tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM product_terms_snapshots WHERE product_id=?1)",
                [product],
                |r| r.get::<_, bool>(0),
            )?
        {
            return Ok(());
        }
        let problem = (links.len() > 256).then_some("source_limit");
        tx.execute("INSERT INTO product_terms_snapshots(product_id,observed_at,problem) VALUES (?1,?2,?3) ON CONFLICT(product_id) DO UPDATE SET observed_at=excluded.observed_at,problem=excluded.problem",params![product,observed,problem])?;
        tx.execute(
            "DELETE FROM product_terms_sources WHERE product_id=?1",
            [product],
        )?;
        for link in links.iter().take(256) {
            let status = if link.google_file_id.is_some() {
                "pending"
            } else {
                "link_only"
            };
            tx.execute("INSERT INTO terms_sources(source_id,source_kind,source_url,google_file_id,status) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(source_id) DO NOTHING",params![link.source_id,link.source_kind,link.source_url,link.google_file_id,status])?;
            tx.execute(
                "INSERT OR IGNORE INTO product_terms_sources VALUES (?1,?2)",
                params![product, link.source_id],
            )?;
            if link.source_kind != "link" {
                tx.execute("INSERT INTO term_observations(product_id,kind,source_kind,source_url,extracted_by,note,observed_at) SELECT ?1,'vn3','link',?2,'vn3-parser/1','captured_link',?3 WHERE NOT EXISTS(SELECT 1 FROM term_observations WHERE product_id=?1 AND source_url=?2 AND extracted_by='vn3-parser/1')",params![product,link.source_url,observed])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn cached_terms_document(
        &self,
        source: &str,
        sha: &str,
        parser: &str,
    ) -> Result<Option<TermsDocument>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        stored_document(&connection, source, sha, parser)
    }

    /// Cache the parse and advance the latest attempt atomically; failure never exposes stale permission.
    pub fn record_terms_result(
        &self,
        source: &str,
        status: &str,
        fetched: &str,
        problem: Option<&str>,
        document: Option<&TermsDocument>,
    ) -> Result<(), BdlStoreError> {
        if ![
            "parsed",
            "unrecognized",
            "unsupported",
            "not_public",
            "failed",
        ]
        .contains(&status)
            || document.is_some_and(|d| {
                d.status != status
                    || d.status != "parsed" && !d.items.is_empty()
                    || d.items.len() > 24
            })
        {
            return Err(BdlStoreError::InvalidObservation("terms result"));
        }
        if status == "parsed" && document.is_none() {
            return Err(BdlStoreError::InvalidObservation("missing terms document"));
        }
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(d) = document {
            tx.execute("INSERT OR IGNORE INTO vn3_documents VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",params![source,d.sha256,d.parser_version,d.status,d.generator_version,d.vn3_version,d.language,d.content_title,d.licensor,d.credit_notation,serde_json::to_string(&d.hashtags)?,d.agreement_version,d.special_note,serde_json::to_string(&d.warnings)?])?;
            for i in &d.items {
                tx.execute(
                    "INSERT OR IGNORE INTO vn3_document_items VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                    params![
                        source,
                        d.sha256,
                        d.parser_version,
                        i.item,
                        i.term_key,
                        i.value,
                        i.condition,
                        i.raw_text,
                        i.summary_raw_text
                    ],
                )?;
            }
        }
        let changed = tx.execute("UPDATE terms_sources SET status=?2,fetched_at=?3,sha256=?4,parser_version=?5,problem=?6 WHERE source_id=?1",params![source,status,fetched,document.map(|d|&d.sha256),document.map(|d|&d.parser_version),problem])?;
        if changed != 1 {
            return Err(BdlStoreError::InvalidObservation("unknown terms source"));
        }
        tx.execute("INSERT INTO term_observations(product_id,kind,source_kind,source_url,source_sha256,extracted_by,note,observed_at) SELECT p.product_id,'vn3','link',s.source_url,s.sha256,'vn3-parser/1',s.status,?2 FROM product_terms_sources p JOIN terms_sources s USING(source_id) WHERE s.source_id=?1 AND NOT EXISTS(SELECT 1 FROM term_observations o WHERE o.product_id=p.product_id AND o.source_url=s.source_url AND o.source_sha256 IS s.sha256 AND o.extracted_by='vn3-parser/1' AND o.note=s.status)",params![source,fetched])?;
        tx.commit()?;
        Ok(())
    }

    pub fn product_terms(&self, product: &str) -> Result<ProductTerms, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let captured: Option<(String, Option<String>)> = connection
            .query_row(
                "SELECT observed_at,problem FROM product_terms_snapshots WHERE product_id=?1",
                [product],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let observed_at = captured.as_ref().map(|c| c.0.clone());
        let capture_problem = captured.and_then(|c| c.1);
        let mut query=connection.prepare("SELECT s.source_id,s.source_kind,s.source_url,s.google_file_id,s.status,s.fetched_at,s.problem,s.sha256,s.parser_version FROM product_terms_sources p JOIN terms_sources s USING(source_id) WHERE p.product_id=?1 ORDER BY s.source_id")?;
        let records = query
            .query_map([product], |row| {
                Ok((
                    TermsSource {
                        link: TermsLink {
                            source_id: row.get(0)?,
                            source_kind: row.get(1)?,
                            source_url: row.get(2)?,
                            google_file_id: row.get(3)?,
                        },
                        status: row.get(4)?,
                        fetched_at: row.get(5)?,
                        problem: row.get(6)?,
                        document: None,
                    },
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut sources = Vec::new();
        for (mut source, sha, parser) in records {
            if let (Some(sha), Some(parser)) = (sha, parser) {
                source.document =
                    stored_document(&connection, &source.link.source_id, &sha, &parser)?;
            }
            sources.push(source);
        }
        let state = compute_product_terms_state(
            observed_at.as_deref(),
            capture_problem.as_deref(),
            &sources,
        )
        .to_owned();
        Ok(ProductTerms {
            schema_version: "0.1".into(),
            product_id: product.into(),
            state,
            observed_at,
            capture_problem,
            sources,
        })
    }

    /// Loads VN3 terms evidence for a bounded slice of product IDs (`WHERE product_id IN (...)`),
    /// reading and parsing only the VN3 documents referenced by those products, and falling back
    /// to `all_product_terms` when more than 50 unique IDs are requested.
    pub fn product_terms_for_ids(
        &self,
        ids: &[String],
    ) -> Result<std::collections::HashMap<String, ProductTerms>, BdlStoreError> {
        use std::collections::{BTreeSet, HashMap};

        let unique_ids: Vec<&str> = {
            let mut seen = BTreeSet::new();
            ids.iter()
                .map(String::as_str)
                .filter(|id| seen.insert(*id))
                .collect()
        };
        if unique_ids.is_empty() {
            return Ok(HashMap::new());
        }
        if unique_ids.len() > 50 {
            return self.all_product_terms();
        }

        let placeholders = (1..=unique_ids.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(",");
        let connection = self.connection.lock().expect("SQLite connection poisoned");

        let mut snapshots: HashMap<String, (String, Option<String>)> = HashMap::new();
        {
            let sql = format!(
                "SELECT product_id,observed_at,problem
                 FROM product_terms_snapshots
                 WHERE product_id IN ({placeholders})"
            );
            let mut stmt = connection.prepare(&sql)?;
            let rows = stmt.query_map(
                rusqlite::params_from_iter(unique_ids.iter().copied()),
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )?;
            for row in rows {
                let (product_id, observed_at, problem) = row?;
                snapshots.insert(product_id, (observed_at, problem));
            }
        }

        let mut docs_by_key: HashMap<(String, String, String), Option<TermsDocument>> =
            HashMap::new();
        let mut sources_by_product: HashMap<String, Vec<TermsSource>> = HashMap::new();
        {
            let sql = format!(
                "SELECT p.product_id,s.source_id,s.source_kind,s.source_url,s.google_file_id,s.status,s.fetched_at,s.problem,s.sha256,s.parser_version
                 FROM product_terms_sources p JOIN terms_sources s USING(source_id)
                 WHERE p.product_id IN ({placeholders})
                 ORDER BY p.product_id,s.source_id"
            );
            let mut stmt = connection.prepare(&sql)?;
            let records = stmt
                .query_map(
                    rusqlite::params_from_iter(unique_ids.iter().copied()),
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            TermsSource {
                                link: TermsLink {
                                    source_id: row.get(1)?,
                                    source_kind: row.get(2)?,
                                    source_url: row.get(3)?,
                                    google_file_id: row.get(4)?,
                                },
                                status: row.get(5)?,
                                fetched_at: row.get(6)?,
                                problem: row.get(7)?,
                                document: None,
                            },
                            row.get::<_, Option<String>>(8)?,
                            row.get::<_, Option<String>>(9)?,
                        ))
                    },
                )?
                .collect::<Result<Vec<_>, _>>()?;
            for (product_id, mut source, sha, parser) in records {
                if let (Some(sha), Some(parser)) = (sha, parser) {
                    let key = (source.link.source_id.clone(), sha, parser);
                    let document = match docs_by_key.get(&key) {
                        Some(cached) => cached.clone(),
                        None => {
                            let loaded = stored_document(&connection, &key.0, &key.1, &key.2)?;
                            docs_by_key.insert(key, loaded.clone());
                            loaded
                        }
                    };
                    source.document = document;
                }
                sources_by_product
                    .entry(product_id)
                    .or_default()
                    .push(source);
            }
        }

        let mut out = HashMap::with_capacity(unique_ids.len());
        for &id in &unique_ids {
            let captured = snapshots.remove(id);
            let observed_at = captured.as_ref().map(|c| c.0.clone());
            let capture_problem = captured.and_then(|c| c.1);
            let sources = sources_by_product.remove(id).unwrap_or_default();
            let state = compute_product_terms_state(
                observed_at.as_deref(),
                capture_problem.as_deref(),
                &sources,
            )
            .to_owned();
            out.insert(
                id.to_owned(),
                ProductTerms {
                    schema_version: "0.1".into(),
                    product_id: id.to_owned(),
                    state,
                    observed_at,
                    capture_problem,
                    sources,
                },
            );
        }
        Ok(out)
    }

    /// Loads every recorded product's VN3 terms evidence in four bulk queries under one lock,
    /// avoiding N+1 queries when annotating or filtering an entire library view.
    pub fn all_product_terms(
        &self,
    ) -> Result<std::collections::HashMap<String, ProductTerms>, BdlStoreError> {
        use std::collections::{BTreeSet, HashMap};

        let connection = self.connection.lock().expect("SQLite connection poisoned");

        let mut items_by_doc: HashMap<(String, String, String), Vec<TermItem>> = HashMap::new();
        {
            let mut stmt = connection.prepare(
                "SELECT source_id,sha256,parser_version,item,term_key,value,condition,raw_text,summary_raw_text
                 FROM vn3_document_items ORDER BY source_id,sha256,parser_version,item",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    (
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ),
                    TermItem {
                        item: row.get(3)?,
                        term_key: row.get(4)?,
                        value: row.get(5)?,
                        condition: row.get(6)?,
                        raw_text: row.get(7)?,
                        summary_raw_text: row.get(8)?,
                    },
                ))
            })?;
            for row in rows {
                let (key, item) = row?;
                items_by_doc.entry(key).or_default().push(item);
            }
        }

        let mut docs_by_key: HashMap<(String, String, String), TermsDocument> = HashMap::new();
        {
            let mut stmt = connection.prepare(
                "SELECT source_id,sha256,parser_version,status,generator_version,vn3_version,language,content_title,licensor,credit_notation,hashtags,agreement_version,special_note,warnings
                 FROM vn3_documents",
            )?;
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                let source_id: String = row.get(0)?;
                let sha256: String = row.get(1)?;
                let parser_version: String = row.get(2)?;
                let hashtags_raw: String = row.get(10)?;
                let warnings_raw: String = row.get(13)?;
                let key = (source_id, sha256.clone(), parser_version.clone());
                let items = items_by_doc.remove(&key).unwrap_or_default();
                docs_by_key.insert(
                    key,
                    TermsDocument {
                        sha256,
                        parser_version,
                        status: row.get(3)?,
                        generator_version: row.get(4)?,
                        vn3_version: row.get(5)?,
                        language: row.get(6)?,
                        content_title: row.get(7)?,
                        licensor: row.get(8)?,
                        credit_notation: row.get(9)?,
                        hashtags: serde_json::from_str(&hashtags_raw)?,
                        agreement_version: row.get(11)?,
                        special_note: row.get(12)?,
                        warnings: serde_json::from_str(&warnings_raw)?,
                        items,
                    },
                );
            }
        }

        let mut snapshots: HashMap<String, (String, Option<String>)> = HashMap::new();
        let mut product_ids: BTreeSet<String> = BTreeSet::new();
        {
            let mut stmt = connection
                .prepare("SELECT product_id,observed_at,problem FROM product_terms_snapshots")?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })?;
            for row in rows {
                let (product_id, observed_at, problem) = row?;
                product_ids.insert(product_id.clone());
                snapshots.insert(product_id, (observed_at, problem));
            }
        }

        let mut sources_by_product: HashMap<String, Vec<TermsSource>> = HashMap::new();
        {
            let mut stmt = connection.prepare(
                "SELECT p.product_id,s.source_id,s.source_kind,s.source_url,s.google_file_id,s.status,s.fetched_at,s.problem,s.sha256,s.parser_version
                 FROM product_terms_sources p JOIN terms_sources s USING(source_id)
                 ORDER BY p.product_id,s.source_id",
            )?;
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                let product_id: String = row.get(0)?;
                let source_id: String = row.get(1)?;
                let sha: Option<String> = row.get(8)?;
                let parser: Option<String> = row.get(9)?;
                let document = match (sha, parser) {
                    (Some(sha), Some(parser)) => {
                        docs_by_key.get(&(source_id.clone(), sha, parser)).cloned()
                    }
                    _ => None,
                };
                product_ids.insert(product_id.clone());
                sources_by_product
                    .entry(product_id)
                    .or_default()
                    .push(TermsSource {
                        link: TermsLink {
                            source_id,
                            source_kind: row.get(2)?,
                            source_url: row.get(3)?,
                            google_file_id: row.get(4)?,
                        },
                        status: row.get(5)?,
                        fetched_at: row.get(6)?,
                        problem: row.get(7)?,
                        document,
                    });
            }
        }

        let mut out = HashMap::with_capacity(product_ids.len());
        for product_id in product_ids {
            let captured = snapshots.remove(&product_id);
            let observed_at = captured.as_ref().map(|c| c.0.clone());
            let capture_problem = captured.and_then(|c| c.1);
            let sources = sources_by_product.remove(&product_id).unwrap_or_default();
            let state = compute_product_terms_state(
                observed_at.as_deref(),
                capture_problem.as_deref(),
                &sources,
            )
            .to_owned();
            out.insert(
                product_id.clone(),
                ProductTerms {
                    schema_version: "0.1".into(),
                    product_id,
                    state,
                    observed_at,
                    capture_problem,
                    sources,
                },
            );
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ProductObservation, ProductObservationStatus};

    fn insert_synthetic_product(store: &BdlStore, id: &str, source_suffix: &str) {
        let now = "2026-11-14T00:00:00.000Z";
        store
            .record_product_observation(&ProductObservation {
                product_id: id.into(),
                native_product_id: id[6..].into(),
                library_type: Some("bought".into()),
                variant_name: None,
                source_url: format!("https://booth.pm/items/{}", &id[6..]),
                final_url: None,
                status: ProductObservationStatus::Complete,
                source_locale: None,
                source_category: None,
                title: Some("Synthetic product".into()),
                description: None,
                age_restriction: None,
                adult: false,
                availability: None,
                price_amount: None,
                price_currency: None,
                shop_name: None,
                shop_url: None,
                image_urls: Vec::new(),
                video_urls: Vec::new(),
                subproducts: Vec::new(),
                source_published_at: None,
                content_hash: format!("sha256:{}", "a".repeat(64)),
                observed_at: now.into(),
                run_id: None,
                processor_version: "synthetic/1".into(),
                missing_fields: Vec::new(),
            })
            .unwrap();
        let link = TermsLink {
            source_id: format!("drive:{source_suffix}"),
            source_kind: "drive".into(),
            source_url: format!("https://drive.google.com/file/d/{source_suffix}/view"),
            google_file_id: Some(source_suffix.into()),
        };
        store
            .record_terms_links(id, std::slice::from_ref(&link), now)
            .unwrap();
        let doc = TermsDocument {
            sha256: format!(
                "{:064x}",
                source_suffix.bytes().fold(0u64, |acc, byte| acc
                    .wrapping_mul(131)
                    .wrapping_add(u64::from(byte)))
            ),
            parser_version: "vn3-parser/1".into(),
            status: "parsed".into(),
            generator_version: Some("1.11".into()),
            vn3_version: Some("1.10".into()),
            language: Some("ja".into()),
            content_title: Some("Synthetic".into()),
            licensor: Some("example.invalid".into()),
            credit_notation: None,
            hashtags: Vec::new(),
            agreement_version: Some("0.42".into()),
            special_note: None,
            warnings: Vec::new(),
            items: vec![TermItem {
                item: "A".into(),
                term_key: "individual_use".into(),
                value: "permitted".into(),
                condition: Some("commercial_and_non_profit".into()),
                raw_text: "Permitted".into(),
                summary_raw_text: Some("Permitted".into()),
            }],
        };
        store
            .record_terms_result(&link.source_id, "parsed", now, None, Some(&doc))
            .unwrap();
    }

    #[test]
    fn product_terms_for_ids_queries_only_requested_products_below_bulk_threshold() {
        let store = BdlStore::open_in_memory().unwrap();
        insert_synthetic_product(&store, "booth:1", "doc1");
        insert_synthetic_product(&store, "booth:2", "doc2");
        insert_synthetic_product(&store, "booth:999", "unrelated");

        // Corrupt the unrelated product's VN3 document JSON so a full-table scan (`all_product_terms`)
        // deterministically fails, proving `product_terms_for_ids` skips unrelated rows.
        {
            let conn = store.connection.lock().unwrap();
            conn.execute(
                r#"UPDATE vn3_documents SET warnings = '[{"unknownField":1}]' WHERE source_id = 'drive:unrelated'"#,
                [],
            )
            .unwrap();
        }
        assert!(store.all_product_terms().is_err());

        let subset = store
            .product_terms_for_ids(&["booth:1".into(), "booth:2".into(), "booth:404".into()])
            .unwrap();
        assert_eq!(subset.len(), 3);
        assert_eq!(subset["booth:1"].state, "parsed");
        assert_eq!(subset["booth:2"].state, "parsed");
        assert_eq!(subset["booth:404"].state, "not_observed");
    }
}
