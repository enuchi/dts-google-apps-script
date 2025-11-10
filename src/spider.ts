// tslint:disable: no-console

'use strict';

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

import cheerio from 'cheerio';
import co from 'co';
import URL from 'url';

const CONCURRENCY = 100;
const MIN_WAIT = 1 * 1000;

interface INode {
  isDeprecated: boolean;
  name: string;
  doc: string;
}

interface IType {
  name: string;
  category: string | null;
}

interface IProperty extends INode {
  type: IType;
}

interface IMethod extends INode {
  params: IProperty[];
  docDetailed: string;
  url: string;
  returnType: IType;
}

interface IDecl extends INode {
  kind: string;
  url: string;
  properties: IProperty[];
  methods: IMethod[];
}

interface ICategory {
  name?: string;
  decls: {
    [key: string]: IDecl;
  };
}
interface ICategories {
  [key: string]: ICategory;
}

class Scraper {
  public static categories: ICategories = {};
  public static queue: string[] = [];
  public static services: any = {};

  public static enqueue(url: string) {
    // tslint:disable-next-line: no-parameter-reassignment
    url = url.replace(/#.*/, '').replace(/\.html$/, '');

    if (url in this._queueued) {
      return;
    }

    this._queueued[url] = true;

    console.error(`<-- <${url}>`);

    this.queue.push(url);
  }

  // tslint:disable-next-line: variable-name
  private static _queueued: any = {};
}

const categoryFromUrl = (url: string | undefined) => {
  const m = url && url.match(/^https:\/\/developers\.google\.com\/apps-script\/reference\/([^/]+)/);
  //  const m = url && url.match(/^https:\/\/developers\.google\.com\/apps-script\/advanced\/([^/]+)/);

  return m ? m[1] : null;
};

const matchClassEnumInterfaceHeading = ($: CheerioStatic) => {
  return $('h1')
    .text()
    .match(/(Class|Enum|Interface) ([a-zA-Z0-9_.]+)/);
};

const matchServiceHeading = ($: CheerioStatic) => {
  return $('h1')
    .text()
    .match(/^\s*(.+) Service/);
};

const getDoc = ($: CheerioStatic) => {
  return $('.type.doc')
    .children()
    .filter(function(this: Cheerio) {
      return $(this).css('display') !== 'none';
    })
    .map(function(this: Cheerio) {
      // handle code blocks that may be wrapped (e.g., div > pre > code)
      const hasPre = $(this).is('pre') || $(this).find('pre').length > 0;
      if (hasPre) {
        const preText = $(this).is('pre') ? $(this).text() : $(this).find('pre').first().text();
        // indent code part
        return `\n${preText
          .split(/\n/)
          .map((line) => `    ${line}`)
          .join('\n')}\n\n`;
      }
      return $(this).text();
    })
    .toArray()
    .join('\n');
};

const resolveHref = (link: Cheerio, url: string) => {
  const href = link.attr('href');

  return href ? URL.resolve(url, href) : undefined;
};

const createProperty = ($: CheerioStatic, cells: Cheerio, typeHref: string | undefined): IProperty => {
  const propertyName = cells.eq(0);
  const isDeprecated =
    $(propertyName)
      .find('s')
      .text().length > 0;
  return {
    doc: cells.eq(2).text(),
    isDeprecated,
    name: cells.eq(0).text(),
    type: {
      category: categoryFromUrl(typeHref),
      name: cells.eq(1).text(),
    },
  };
};

const addPropertiesToDecl = ($: CheerioStatic, decl: IDecl, url: string) => {
  $('table.members.property tr:not(:first-child)').each(function(this: Cheerio) {
    const cells = $(this).find('td');
    if (cells.length === 3) {
      const type = cells.eq(1);
      const typeHref = resolveHref(type.find('a'), url);
      if (typeHref) {
        Scraper.enqueue(typeHref);
      }

      decl.properties.push(createProperty($, cells, typeHref));
    }
  });
};

const createMethod = ($: CheerioStatic, cells: Cheerio, typeHref: string | undefined, methodUrl: string): IMethod => {
  const methodName = cells.eq(0);
  const isDeprecated =
    $(methodName)
      .find('s')
      .text().length > 0;
  return {
    doc: cells.eq(2).text(),
    docDetailed: '',
    url: methodUrl,
    isDeprecated,
    name: cells
      .eq(0)
      .text()
      .replace(/\(.*$/, ''),
    params: [],
    returnType: {
      category: categoryFromUrl(typeHref),
      name: cells.eq(1).text(),
    },
  };
};

const getMethod = ($: CheerioStatic, cells: Cheerio, typeHref: string | undefined, url: string) => {
  const detailId = cells
    .eq(0)
    .find('a')
    .attr('href')
    .substring(1);
  const method = createMethod($, cells, typeHref, `${url}#${detailId}`);
  const methodSection = $('*[id]').filter(function(this: Cheerio) {
    return $(this).attr('id') === detailId;
  });

  // Collect advanced parameters up-front for use in the section output
  const advancedParamsForDoc: string[] = [];
  methodSection.find('table.function.advancedparam tr:not(:first-child)').each(function(this: Cheerio) {
    const cells = $(this).find('td');
    if (cells.length === 3) {
      const name = cells.eq(0).text().trim();
      const typeText = cells.eq(1).text().trim();
      const desc = cells
        .eq(2)
        .text()
        .replace(/\s+/g, ' ')
        .trim();
      if (name && typeText && desc) {
        advancedParamsForDoc.push(`${name} (${typeText}) — ${desc}`);
      }
    }
  });

  const detailedDocsLines: string[] = [];
  let currentSection: 'return' | 'throws' | 'authorization' | 'advanced' | null = null;
  methodSection
    .children('div')
    .children()
    .each(function(this: Cheerio) {
      if ($(this).is('h4')) {
        const title = $(this)
          .text()
          .trim()
          .toLowerCase();
        // close previous section with two blank lines
        if (currentSection) {
          detailedDocsLines.push('', '');
          currentSection = null;
        }
        if (title === 'return') {
          detailedDocsLines.push('Return:');
          currentSection = 'return';
        } else if (title === 'throws') {
          detailedDocsLines.push('Throws:');
          currentSection = 'throws';
        } else if (title === 'authorization') {
          detailedDocsLines.push('Authorization:');
          currentSection = 'authorization';
        } else if (title === 'advanced parameters') {
          // Label as Parameters per example
          detailedDocsLines.push('Parameters:');
          currentSection = 'advanced';
          // Immediately print advanced parameter bullets if already collected
          if (advancedParamsForDoc.length) {
            advancedParamsForDoc.forEach((p) => detailedDocsLines.push(`- ${p}`));
            // two blank lines after the section per formatting requirement
            detailedDocsLines.push('', '');
            currentSection = null;
          }
        }
        return; // handled heading
      }

      if ($(this).is('p')) {
        const text = $(this)
          .text()
          .replace(/\s+/g, ' ')
          .trim();
        if (currentSection === 'return' || currentSection === 'throws') {
          detailedDocsLines.push(`- ${text}`);
        } else if (currentSection === 'authorization') {
          // include the descriptive line under Authorization before the bullet list
          detailedDocsLines.push(text);
        } else {
          detailedDocsLines.push(text);
        }
      } else if ($(this).is('ul')) {
        // capture bullet lists such as Authorization scopes
        $(this)
          .find('li')
          .each(function(this: Cheerio) {
            const itemText = $(this).text().trim();
            if (itemText) detailedDocsLines.push(`- ${itemText}`);
          });
      } else {
        // handle code blocks possibly wrapped in containers (e.g., devsite-code > pre)
        const hasPre = $(this).is('pre') || $(this).find('pre').length > 0;
        if (hasPre) {
          const preText = $(this).is('pre') ? $(this).text() : $(this).find('pre').first().text();
          // indent code part
          detailedDocsLines.push(
            preText
              .split(/\n/)
              .map((line) => `    ${line}`)
              .join('\n'),
          );
        } // ignore other element types and continue scanning
      }
    });

  // ensure two blank lines after a trailing open section
  if (currentSection) {
    detailedDocsLines.push('', '');
    currentSection = null;
  }

  if (detailedDocsLines.length) method.docDetailed = detailedDocsLines.join('\n');

  methodSection.find('table.function.param tr:not(:first-child)').each(function(this: Cheerio) {
    const paramCells = $(this).find('td');
    if (paramCells.length === 3) {
      const type = paramCells.eq(1);
      const paramTypeHref = resolveHref(type.find('a'), url);

      if (paramTypeHref) {
        Scraper.enqueue(paramTypeHref);
      }

      method.params.push(createProperty($, paramCells, paramTypeHref));
    }
  });

  // Append Advanced parameters summary into the options parameter doc as well
  if (advancedParamsForDoc.length) {
    const summary = `Advanced parameters: ${advancedParamsForDoc.join('; ')}`;
    const optionsParam = method.params.find((p) => p.name.trim() === 'options');
    if (optionsParam) {
      const baseDoc = optionsParam.doc ? optionsParam.doc.replace(/\s+/g, ' ').trim() : '';
      optionsParam.doc = baseDoc ? `${baseDoc} ${summary}` : summary;
    }
  }
  return method;
};

const addMethodsToDecl = ($: CheerioStatic, decl: IDecl, url: string) => {
  $('table.members.function tr:not(:first-child)').each(function(this: Cheerio) {
    const cells = $(this).find('td');
    if (cells.length === 3) {
      const type = cells.eq(1);
      const typeHref = resolveHref(type.find('a'), url);

      if (typeHref) {
        Scraper.enqueue(typeHref);
      }

      decl.methods.push(getMethod($, cells, typeHref, url));
    }
  });
};

const createDecl = ($: CheerioStatic, matchHeading: RegExpMatchArray, url: string): IDecl => {
  return {
    doc: getDoc($),
    isDeprecated: false, // TODO: implement
    kind: matchHeading[1].toLowerCase(),
    methods: [],
    name: matchHeading[2],
    properties: [],
    url,
  };
};

function visit(url: string) {
  const name = categoryFromUrl(url);

  if (name) {
    const categories = Scraper.categories;
    categories[name] = categories[name] || { decls: {}, debugUrl: url, debugName: name };
    // categories[name] = categories[name] || { decls: {} };
    const category = categories[name];

    console.error(`==> ${url}`);

    const config: AxiosRequestConfig = {
      url,
      // method: 'get',
      // baseURL: '',
      // responseType: 'document',
      // transformResponse: (data, headers) => {
      //   return data;
      // }
      // Treat all HTTP statuses as resolved; we'll handle errors explicitly
      validateStatus: () => true,
      headers: {
        'User-Agent': 'dts-google-apps-script-bot/1.0 (+https://github.com/motemen/dts-google-apps-script)',
      },
    };

    return axios(config).then((response: AxiosResponse<string>) => {
      if (response.status >= 400) {
        console.error(`SKIP ${response.status} ${url}`);
        return;
      }
      const $ = cheerio.load(response.data);

      let matchHeading: RegExpMatchArray | null = matchClassEnumInterfaceHeading($);
      if (matchHeading) {
        const decl: IDecl = createDecl($, matchHeading, url);

        addPropertiesToDecl($, decl, url);
        addMethodsToDecl($, decl, url);
        category.decls[decl.name] = decl;
      } else {
        matchHeading = matchServiceHeading($);
        if (matchHeading) {
          category.name = matchHeading[1];
        } else {
          console.error(`!!! unexpected heading: ${$('h1').text()}`);
        }
      }
    });
  }

  return;
}

/*
Argument of type '
() => Generator<AxiosPromise<any> | Promise<any[]>, void, AxiosResponse<any>>
' is not assignable to parameter of type '
(...args: any[]) => Iterator<any, any, undefined>
'.
  Type 'Generator<AxiosPromise<any> | Promise<any[]>, void, AxiosResponse<any>>' is not assignable to type 'Iterator<any, any, undefined>'.
    Types of property 'next' are incompatible.
      Type '(...args: [] | [AxiosResponse<any>]) => IteratorResult<AxiosPromise<any> | Promise<any[]>, void>' is not assignable to type '(...args: [] | [undefined]) => IteratorResult<any, any>'.
        Types of parameters 'args' and 'args' are incompatible.
          Type '[] | [undefined]' is not assignable to type '[] | [AxiosResponse<any>]'.
            Type '[undefined]' is not assignable to type '[] | [AxiosResponse<any>]'.
              Type '[undefined]' is not assignable to type '[AxiosResponse<any>]'.
                Type 'undefined' is not assignable to type 'AxiosResponse<any>'.
*/

co(function*(): any {
  const startURL = 'https://developers.google.com/apps-script/reference/';

  const config: AxiosRequestConfig = {
    url: startURL,
  };
  const response: AxiosResponse = yield axios(config);
  const $ = cheerio.load(response.data);

  // create a list to store GAS "service" expandable docs
  const googleServiceBlocks: Cheerio[] = [];

  // start from "Overview" links and select parent
  $('a').each(function(this: Cheerio) {
    if ($(this).text() === 'Overview') {
      // find nearest parent expandable wrapper section
      // some expandable sections are deeply nested so this finds the deepest level
      const wrapper = $(this).closest('ul.devsite-nav-section');

      if (wrapper) {
        googleServiceBlocks.push(wrapper);
      }
    }
  });

  googleServiceBlocks.forEach((wrapper) => {
    $(wrapper).each(function(this: Cheerio) {
      let inServices = false;
      $(wrapper)
        .find('li')
        .each(function(this: Cheerio) {
          const name = $(this)
            .text()
            .replace(/(\r\n|\n|\r)/gm, '')
            .trim();

          if (name === 'Overview') {
            inServices = true;
          }

          if (name === 'Classes') {
            inServices = false;
          }

          let url = $(this)
            .find('a[href]')
            .attr('href');
          if (url) {
            url = URL.resolve(startURL, url);

            Scraper.enqueue(url);

            if (inServices) {
              Scraper.services[url] = true;
            }
          }
        });
    });
  });

  while (Scraper.queue.length > 0) {
    const urls: string[] = Scraper.queue.splice(0, CONCURRENCY);

    yield Promise.all(
      urls
        .map((url) => (visit(url) as unknown) as Promise<any>)
        .concat(new Promise<any>((ok) => setTimeout(ok, MIN_WAIT))),
    );
  }

  return;
})
  .then(() => {
    const result = {
      categories: Scraper.categories,
      services: Scraper.services,
    };

    console.log(JSON.stringify(result, undefined, 2));

    process.exit(0);
  })
  .catch((err: any) => {
    console.error(`ERR ${err}`);

    process.exit(1);
  });
