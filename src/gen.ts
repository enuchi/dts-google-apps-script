#!/usr/bin/env node --harmony

// tslint:disable: no-console

import fs from 'fs';

const GasNamespace = 'GoogleAppsScript';
const deprecationNotice = '/** @deprecated DO NOT USE */ ';

const header = fs.readFileSync('HEADER', { encoding: 'utf-8' }).replace(/{date}/, () => {
  const date = new Date();

  return `${date.getFullYear()}-${`0${date.getMonth() + 1}`.substr(-2)}-${`0${date.getDate()}`.substr(-2)}`;
});

let input = '';
process.stdin.on('data', (buf) => (input += buf.toString()));
process.stdin.on('end', () => {
  const data = JSON.parse(input);

  const indent = (text: string) => text.replace(/^./, '  $&');

  const makeDocComment = (docComment: string) => {
    const lines: string[] = [];
    lines.push('/**');
    docComment
      .replace(/( *\n){3,}/g, '\n\n')
      .replace(/\s+$/, '')
      .split(/\n/)
      .forEach((line) => lines.push(` * ${line}`));

    lines.push(' */');

    return lines;
  };

  const makeMethodDoc = (method: { docDetailed: string; url: string; isDeprecated: boolean; params: any }) => {
    const { docDetailed, url, isDeprecated, params } = method;
    if (isDeprecated) return [];
    const lines: string[] = [];
    lines.push(`\n      /**`);
    
    // Process docDetailed to normalize blank lines and ensure proper spacing
    // First, remove the entire "Parameters:" section since we show advanced parameters after @param tags
    let cleanedDocDetailed = docDetailed;
    // Remove "Parameters:" section: find "Parameters:" and remove it and all following lines that are bullet points
    // until we hit a blank line or a section header (Return:, Throws:, Authorization:)
    const docLines = cleanedDocDetailed.split('\n');
    const filteredLines: string[] = [];
    let skipParameters = false;
    for (let i = 0; i < docLines.length; i++) {
      const line = docLines[i];
      const trimmed = line.trim();
      if (trimmed === 'Parameters:') {
        skipParameters = true;
        continue; // Skip the "Parameters:" line itself
      }
      if (skipParameters) {
        // Stop skipping when we hit a blank line followed by a section header, or a section header directly
        if (trimmed === '' && i + 1 < docLines.length) {
          const nextLine = docLines[i + 1].trim();
          if (/^(Return|Throws|Authorization):/.test(nextLine)) {
            skipParameters = false;
            filteredLines.push(line); // Keep the blank line
            continue;
          }
        }
        if (/^(Return|Throws|Authorization):/.test(trimmed)) {
          skipParameters = false;
          filteredLines.push(line);
          continue;
        }
        // Skip bullet points and other content in Parameters section
        if (trimmed.startsWith('- ') || trimmed === '') {
          continue;
        }
        // If we hit non-bullet, non-blank content, stop skipping (might be start of next section)
        skipParameters = false;
        filteredLines.push(line);
        continue;
      }
      filteredLines.push(line);
    }
    cleanedDocDetailed = filteredLines.join('\n');
    
    const detailLines = cleanedDocDetailed.split('\n');
    const processedLines: string[] = [];
    let prevWasBlank = false;
    let prevWasCode = false;
    for (let i = 0; i < detailLines.length; i++) {
      const line = detailLines[i];
      const trimmed = line.trim();
      const isBlank = trimmed === '';
      // Code blocks are indented with 4+ spaces (not just whitespace-only lines)
      const isCode = !isBlank && (line.startsWith('    ') || /^[ ]{4,}/.test(line));
      
      // Skip method signatures FIRST (lines like "- createDraft(recipient, subject, body, options)" or "- GmailApp.createDraft(...)")
      // This must be checked before any other processing
      if (!isBlank) {
        // Remove any JSDoc prefix if present
        const cleanLine = trimmed.replace(/^\*\s*/, '').trim();
        // Check if line is a method signature: starts with "- " followed by method name and parentheses with content
        if (/^-\s+[A-Za-z][A-Za-z0-9_.]*\s*\([^)]+\)/.test(cleanLine) || /^-\s+[A-Za-z][A-Za-z0-9_.]*\s*\([^)]+\)/.test(trimmed)) {
          continue;
        }
      }
      
      // Skip consecutive blank lines
      if (isBlank && prevWasBlank) {
        continue;
      }
      
      // Add blank line before code block if needed (check this early, before other processing)
      if (isCode && !prevWasCode && processedLines.length > 0) {
        const lastLine = processedLines[processedLines.length - 1].trim();
        // Only add blank line if previous line wasn't already blank and wasn't a section header
        if (lastLine !== '' && !/^[A-Z][a-zA-Z ]+:$/.test(lastLine)) {
          processedLines.push('');
        }
      }
      
      // Add blank line before "Return:" or "Throws:" section headers if needed
      if (!isBlank && !isCode && (trimmed === 'Return:' || trimmed === 'Throws:')) {
        if (processedLines.length > 0) {
          const lastLine = processedLines[processedLines.length - 1].trim();
          // Add blank line if previous line wasn't already blank
          if (lastLine !== '') {
            processedLines.push('');
          }
        }
      }
      
      // Check if previous line was "Authorization:" - add blank line before descriptive text
      // This must come after code block check but before the section header blank line skip
      if (!isBlank && !isCode && processedLines.length > 0) {
        const lastLine = processedLines[processedLines.length - 1].trim();
        if (lastLine === 'Authorization:') {
          // Add blank line after Authorization: header before the descriptive text
          processedLines.push('');
        }
      }
      
      // Skip blank line immediately after section header (except Authorization: which we handle above)
      if (isBlank && processedLines.length > 0) {
        const lastLine = processedLines[processedLines.length - 1].trim();
        if (/^[A-Z][a-zA-Z ]+:$/.test(lastLine) && lastLine !== 'Authorization:') {
          continue;
        }
      }
      
      // Add blank line after code block if transitioning to non-code, non-blank text
      if (prevWasCode && !isBlank && !isCode) {
        // Only add blank line if previous line wasn't already blank
        if (processedLines.length > 0 && processedLines[processedLines.length - 1].trim() !== '') {
          processedLines.push('');
        }
      }
      
      processedLines.push(line);
      prevWasBlank = isBlank;
      prevWasCode = isCode;
    }
    
    // Remove trailing blank lines
    while (processedLines.length > 0 && processedLines[processedLines.length - 1].trim() === '') {
      processedLines.pop();
    }
    
    lines.push(...processedLines.map((detailLine) => `     * ${detailLine}`));
    
    // Always add blank line before URL (remove trailing blank lines first if any)
    // Remove any trailing blank lines that might have been added
    while (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      // Check if it's a blank JSDoc line (either "     *" or "     * " with just whitespace)
      if (lastLine.trim() === '     *' || (lastLine.startsWith('     *') && lastLine.trim().length === 6)) {
        lines.pop();
      } else {
        break;
      }
    }
    // Always ensure there's a blank line before the URL
    lines.push(`     *`);
    lines.push(`     * ${url}`);
    
    // Extract advanced parameters from options param before formatting @param tags
    const optionsParam = params.find((p: any) => p.name.trim() === 'options');
    let advancedParams: string[] = [];
    let optionsBaseDoc = '';
    if (optionsParam && optionsParam.doc) {
      const optionsDoc = optionsParam.doc.replace(/\n\s*/g, ' ');
      // Split at "Advanced parameters:" to get base doc and advanced params
      const parts = optionsDoc.split(/\s+Advanced parameters:\s*/);
      if (parts.length > 1) {
        optionsBaseDoc = parts[0].trim();
        const advancedParamsText = parts[1];
        // Split by semicolon, but only when followed by a pattern that looks like a new parameter
        // Pattern: semicolon followed by optional whitespace, then a word, then opening paren
        advancedParams = advancedParamsText
          .split(/;\s*(?=[a-zA-Z_][a-zA-Z0-9_\[\]]*\s*\()/)
          .map((p: string) => p.trim().replace(/;?\s*$/, ''))
          .filter((p: string) => p.length > 0);
      } else {
        optionsBaseDoc = optionsDoc;
      }
    }
    
    // Format @param tags, using base doc for options param
    params.forEach((param: any) => {
      let paramDoc = param.doc.replace(/\n\s*/g, ' ');
      // If this is the options param and we extracted advanced params, use base doc only
      if (param.name.trim() === 'options' && advancedParams.length > 0 && optionsBaseDoc) {
        paramDoc = optionsBaseDoc;
      } else {
        // For other params, remove "Advanced parameters:" if present
        paramDoc = paramDoc.replace(/\s+Advanced parameters:.*$/, '').trim();
      }
      lines.push(`     * @param ${param.name} ${paramDoc}`);
    });
    
    // Add advanced parameters section if present
    if (advancedParams.length > 0) {
      lines.push(`     *`);
      lines.push(`     * Advanced parameters:`);
      advancedParams.forEach((param: string) => {
        lines.push(`     * - ${param}`);
      });
    }
    
    lines.push('     */\n    ');
    return lines;
  };

  Object.keys(data.categories)
    .sort()
    .forEach((categoryKey) => {
      let result: string[] = [];
      const exports: any = {};
      const category = data.categories[categoryKey];
      // const categoryName = category.name.replace(/\W/g, '_');
      const categoryName = category.name ? category.name.replace(/\W/g, '_') : 'UNKNOWN';
      const decls = category.decls;
      let references: string[];

      const makeTypedName = (o: any, isField?: boolean) => {
        let name = o.name;
        let typeName = o.type.name;
        const typeCategory = o.type.category;
        const dataCategory = data.categories[typeCategory];

        // Known types from manually-maintained types.d.ts file
        // These are not in scraped data but are always available
        const knownTypesFromTypesFile = new Set(['Byte', 'Integer', 'Char', 'BigNumber', 'JdbcSQL_XML']);

        // Extract base type name (before array notation or other modifiers)
        const baseTypeName = typeName.replace(/\[\]$/, '').trim();
        const hasArrayNotation = typeName.endsWith('[]');

        // Check if type actually exists in scraped data
        let typeExists = false;
        
        // First check if it's a known type from types.d.ts
        if (knownTypesFromTypesFile.has(baseTypeName)) {
          typeExists = true;
        } else if (typeCategory) {
          // Check if type exists in the specified category
          typeExists = dataCategory && dataCategory.decls && dataCategory.decls[baseTypeName] !== undefined;
        } else {
          // If no category specified, check current category first, then all categories
          const currentCategory = data.categories[categoryKey];
          if (currentCategory && currentCategory.decls) {
            typeExists = currentCategory.decls[baseTypeName] !== undefined;
          }
          
          // If not found in current category, search all categories
          if (!typeExists) {
            for (const catKey in data.categories) {
              const cat = data.categories[catKey];
              if (cat && cat.decls && cat.decls[baseTypeName] !== undefined) {
                typeExists = true;
                break;
              }
            }
          }
        }

        // If type doesn't exist, replace with 'any' to avoid TypeScript errors
        // Preserve array notation if present
        if (!typeExists && typeName !== 'any' && !typeName.match(/^(Boolean|Number|String|any)\W*$/)) {
          // Only replace if the base type doesn't exist AND it's not a known type from types.d.ts
          // (We already checked knownTypesFromTypesFile above, so if typeExists is false here,
          //  it means the type truly doesn't exist)
          typeName = hasArrayNotation ? 'any[]' : 'any';
        }

        const typeIsEnum =
          isField === true &&
          dataCategory &&
          dataCategory.decls &&
          dataCategory.decls[baseTypeName] &&
          dataCategory.decls[baseTypeName].kind === 'enum';

        if (typeCategory && typeCategory !== categoryKey && typeExists) {
          typeName = dataCategory.name ? `${dataCategory.name.replace(/\W/g, '_')}.${typeName}` : `UNKNOWN.${typeName}`;
          if (references.indexOf(typeCategory) === -1) {
            references.push(typeCategory);
          }
        }

        // https://github.com/DefinitelyTyped/DefinitelyTyped/commit/dcb04cab793b8e2541274ca83d4fe39afe73e1b3
        typeName = typeName.replace('Object', 'any');

        // these are not defined in docs so types are not generated properly 
        typeName = typeName.replace(/(TimeInterval|TargetAudience)/g, 'any');

        if (/^(.+)\.\.\.$/.test(typeName)) {
          typeName = `${RegExp.$1}[]`;
          name = `...${o.name}`;
        }

        if (typeName.match(/^(Boolean|Number|String)\W*$/)) {
          typeName = typeName.toLowerCase();
        }

        return `${name}: ${typeIsEnum ? 'typeof ' : ''}${typeName}`;
      };

      references = ['types'];
      result.push(`declare namespace ${GasNamespace} {`, `  namespace ${categoryName} {`);

      Object.keys(decls)
        .sort()
        .forEach((declsKey) => {
          const decl = decls[declsKey];

          if (decl) {
            const lines = makeDocComment(decl.doc);
            const names = declsKey.split(/\./);
            const name = names.pop() as string;

            names.forEach((ns) => lines.push(`namespace ${ns} {`));

            if (decl.kind === 'enum') {
              lines.push(`enum ${name} { ${decl.properties.map((p: any) => p.name).join(', ')} }`);
            } else {
              // extend certain interfaces:
              // https://github.com/DefinitelyTyped/DefinitelyTyped/commit/08bab0b659e21b94dbd04b70585508cd64e8284c
              // https://github.com/DefinitelyTyped/DefinitelyTyped/commit/f78a6e7b4748aff75150cf2bbe5140c88985ca5a#

              if (name === 'Blob') {
                lines.push(`interface Blob extends BlobSource {`);
              } else if (
                categoryName === 'Document' &&
                new Set([
                  'Body',
                  'ContainerElement',
                  'Equation',
                  'EquationFunction',
                  'EquationFunctionArgumentSeparator',
                  'EquationSymbol',
                  'FooterSection',
                  'Footnote',
                  'FootnoteSection',
                  'HeaderSection',
                  'HorizontalRule',
                  'InlineDrawing',
                  'InlineImage',
                  'ListItem',
                  'PageBreak',
                  'Paragraph',
                  'Table',
                  'TableCell',
                  'TableOfContents',
                  'TableRow',
                  'Text',
                  'UnsupportedElement',
                ]).has(name)
              ) {
                lines.push(`interface ${name} extends Element {`);
              } else {
                // all other interfaces
                lines.push(`interface ${name} {`);
              }

              lines.push(
                ...decl.properties
                  .map((p: any) => `${p.isDeprecated ? deprecationNotice : ''}${makeTypedName(p, true)};`)
                  .map(indent),
              );
              lines.push(
                ...decl.methods.map((method: any) =>
                  [
                    makeMethodDoc(method)
                      .map(indent)
                      .join('\n'),
                    indent(
                      `${method.isDeprecated ? deprecationNotice : ''}${makeTypedName({
                        name: `${method.name}(${
                          method.params
                            .map(makeTypedName)
                            .join(', ')
                            .replace(/(\bsql:.*)\bsql:/g, '$1sql_:') // ad-hoc fix for same-named arguments in jdbc
                        })`,
                        type: method.returnType,
                      })};`,
                    ),
                  ].join(''),
                ),
              );
              lines.push('}');
            }

            names.forEach(() => lines.push('}'));
            // lines.push('');

            if (data.services[decl.url]) {
              exports[name] = true;
            }

            result = result.concat(lines.map(indent).map(indent));
          }
        });

      result.push('  }', '}', '');

      Object.keys(exports)
        .sort()
        .forEach((declsKey) => {
          const line = `declare var ${declsKey}: ${GasNamespace}.${categoryName}.${declsKey};`;
          if (declsKey === 'MimeType') {
            result.push('// conflicts with MimeType in lib.d.ts');
            result.push(`// ${line}`);
          } else {
            result.push(line);
          }
        });

      result = [header]
        .concat(references.map((ref) => `/// <reference path="google-apps-script.${ref}.d.ts" />`))
        .concat('', result);

      const filename = `google-apps-script/google-apps-script.${categoryKey}.d.ts`;
      const fd = fs.openSync(filename, 'w');
      fs.writeSync(fd, `${result.join('\n').replace(/ +$/gm, '')}\n`);
      console.error(`Wrote to ${filename}`);
    });
});
