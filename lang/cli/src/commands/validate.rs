//! Validate command - validates a .rune file

use std::fs;
use std::path::Path;

use rune_parser::{parse_document, LineKind};

/// Validation error
#[derive(Debug)]
pub struct ValidationError {
    pub line: usize,
    pub message: String,
}

/// Validate a .rune file
pub fn validate(input_path: &Path) -> Result<Vec<ValidationError>, String> {
    let content = fs::read_to_string(input_path)
        .map_err(|e| format!("Failed to read {}: {}", input_path.display(), e))?;

    let lines = parse_document(&content);
    let mut errors = Vec::new();

    for parsed_line in &lines {
        // Check for Unknown lines (parse errors)
        if let LineKind::Unknown(text) = &parsed_line.kind {
            errors.push(ValidationError {
                line: parsed_line.line_num + 1,
                message: format!("Parse error: {}", text),
            });
        }

        // Check 80 column limit — the rune contract is per-character, so count
        // chars (not UTF-8 bytes) for both the test and the reported count.
        let line_text = content.lines().nth(parsed_line.line_num).unwrap_or("");
        let char_count = line_text.chars().count();
        if char_count > 80 {
            errors.push(ValidationError {
                line: parsed_line.line_num + 1,
                message: format!("Line exceeds 80 columns ({} chars)", char_count),
            });
        }
    }

    Ok(errors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn validates_correct_file() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("example.rune");

        fs::write(&input_path, r#"[REQ] test.run(InputDto): OutputDto
    id::create(name): id

[DTO] InputDto: name
    input
"#).unwrap();

        let result = validate(&input_path);
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn detects_long_lines() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("example.rune");

        // Create a line longer than 80 characters
        let long_line = "x".repeat(100);
        fs::write(&input_path, format!("[TYP] {}: string", long_line)).unwrap();

        let result = validate(&input_path);
        assert!(result.is_ok());
        let errors = result.unwrap();
        assert!(!errors.is_empty());
        assert!(errors[0].message.contains("80 columns"));
    }

    #[test]
    fn r4_80_column_check_counts_chars_not_bytes() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("example.rune");

        // "[TYP] " + 'ᚱ' (U+16B1, 3 bytes) * 30 + ": string"
        // => 44 characters but 104 bytes. A char-based 80-column check must NOT
        // flag this line.
        let line = format!("[TYP] {}: string", "ᚱ".repeat(30));
        assert_eq!(line.chars().count(), 44);
        assert!(line.len() > 80, "precondition: byte length exceeds 80");
        fs::write(&input_path, &line).unwrap();

        let result = validate(&input_path);
        assert!(result.is_ok());
        let errors = result.unwrap();
        assert!(
            !errors.iter().any(|e| e.message.contains("80 columns")),
            "a 44-char (104-byte) line must not be flagged as over 80 columns, got: {:?}",
            errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );
    }

    #[test]
    fn r4_long_line_reports_char_count_not_byte_count() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("example.rune");

        // 90 multi-byte chars: 90 chars > 80, and the reported count must be 90
        // (chars), not the byte length (270).
        let line = format!("[TYP] {}: x", "é".repeat(90));
        assert_eq!(line.chars().count(), 90 + "[TYP] : x".chars().count());
        fs::write(&input_path, &line).unwrap();

        let result = validate(&input_path);
        let errors = result.unwrap();
        let col_err = errors
            .iter()
            .find(|e| e.message.contains("80 columns"))
            .expect("a >80-char line must be flagged");
        let expected_chars = line.chars().count();
        assert!(
            col_err.message.contains(&format!("({} chars)", expected_chars)),
            "reported count must be char count {}, got: {}",
            expected_chars,
            col_err.message
        );
    }

    #[test]
    fn detects_parse_errors() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("example.rune");

        fs::write(&input_path, "invalid line without tag").unwrap();

        let result = validate(&input_path);
        assert!(result.is_ok());
        let errors = result.unwrap();
        assert!(!errors.is_empty());
        assert!(errors[0].message.contains("Parse error"));
    }
}
