import * as path from "path";
import * as fs from "fs-promise";
import * as _ from "underscore";
import * as ejs from "ejs";
import * as cheerio from "cheerio";
import * as request from "request";
import * as mime from "mime";
import * as archiver from "archiver";
import * as rimraf from "rimraf";
var uslug = require("uslug");
var entities = require("entities");
var removeDiacritics = require("diacritics").remove;
var delay = require("promise-delay");

var Bottleneck = require("bottleneck");
Bottleneck.prototype.Promise = require("any-promise");

Promise = require("any-promise");

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r;
    r = Math.random() * 16 | 0;
    return (c === 'x' ? r : r & 0x3 | 0x8).toString(16);
  });
}

export interface Chapter
{
    title?: string;
    author?: string | string[];
    data: string;
    excludeFromToc?: boolean;
    beforeToc?: boolean;
    filename?: string;
    url?: string;
}

export interface Options {
    title: string;
    author: string | string[];
    publisher?: string;
    cover?: string;
    output?: string;
    version?: 2 | 3;
    css?: string;
    fonts?: string[];
    lang?: "en" | string;
    appendChapterTitles?: boolean;
    customOpfTemplatePath?: string;
    customNcxTocTemplatePath?: string;
    customHtmlTocTemplatePath?: string;
    content?: Chapter[];
    keywords?: string[];
    source?: string;
    trustContent?: boolean;
}

interface Image {
    id: string;
    url: string;
    dir: string;
    mediaType: string;
    extension: string;
}

type ExtOptions = Options & Partial<{
  description: string;
  tocTitle: string;
  date: string;
  docHeader: string;
  tempDir: string;
  id: string;
  uuid: string;
  images: Image[];
  _coverMediaType: string;
  _coverExtension: string;
}>;

type ExtChapter = Chapter & Partial<{
  href: string;
  filePath: string;
  id: string;
  dir: string;
}>;

export interface IHost {
  downloadFile(url: string, path: string): Promise<void>;
}

class Host implements IHost {
  private limiter: any;
  constructor() {
    this.limiter = new Bottleneck(5, 0, -1, null, true);
  }

  downloadFile(url: string, path: string): Promise<void> {
    return this.limiter.schedule(async (url: string, path: string) => {
      var times = 0;
      var retryLimit = 5;
      console.log(`Get: ${url}`);
      while (true) {
          try {
              await this.tryDownloadFile(url, path);
              console.log(`Done: ${url}`);
              return;
          } catch(err) {
              times++;
              if (times >= retryLimit) {
                  throw err;
              } else {
                  console.error(`Retry ${times}: `, url);
                  await delay(1000);
              }
          }
      }
    }, url, path);
  }

  private tryDownloadFile(url: string, path: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/34.0.1847.116 Safari/537.36";
      var called = false;
      function cb(err?: any) {
        if (!called) {
          called = true;
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      }

      let readStream;
      if (url.slice(0, 4) === "http") {
        readStream = request.get(url, {
          headers: {
            "User-Agent": userAgent
          }
        });
      } else if (url.slice(0, 4) === "file") {
        url = url.slice(8);
        readStream = fs.createReadStream(url);
      } else {
        readStream = fs.createReadStream(url)
      }
      let writeStream = fs.createWriteStream(path);
      readStream.on("error", cb);
      writeStream.on("error", cb);
      writeStream.on("close", () => cb());
      readStream.pipe(writeStream);
    });
  }
}

export default class EPub {
  private readonly host: IHost;
  private readonly options: ExtOptions;
  private id: string;
  private uuid: string;
  public promise: Promise<void>;

  constructor(options: Options, output?: string, host: IHost = new Host()) {
    this.host = host;
    let self = this;
    if (output) {
      options.output = output;
    }
    if (!options.output) {
      console.error(new Error("No Output Path"));
      this.promise = Promise.reject(new Error("No output path"));
      return;
    }
    if (!options.title || !options.content) {
      console.error(new Error("Title and content are both required"));
      this.promise = Promise.reject(new Error("Title and content are both required"));
      return;
    }
    this.options = {
      description: options.title,
      publisher: "anonymous",
      author: ["anonymous"],
      tocTitle: "Table Of Contents",
      appendChapterTitles: true,
      date: new Date().toISOString(),
      lang: "en",
      fonts: [],
      customOpfTemplatePath: null,
      customNcxTocTemplatePath: null,
      customHtmlTocTemplatePath: null,
      version: 3,
      ...options
    };

    if (this.options.version === 2) {
      this.options.docHeader = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.1//EN\" \"http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd\">\n<html xmlns=\"http://www.w3.org/1999/xhtml\" lang=\"" + self.options.lang + "\">";
    } else {
      this.options.docHeader = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" lang=\"" + self.options.lang + "\">";
    }

    if (_.isString(this.options.author)) {
      this.options.author = [this.options.author];
    }
    if (_.isEmpty(this.options.author)) {
      this.options.author = ["anonymous"];
    }
    if (!this.options.tempDir) {
      this.options.tempDir = path.resolve(__dirname, "./tempDir/");
    }
    this.id = uuid();
    this.uuid = path.resolve(this.options.tempDir, this.id);
    this.options.uuid = this.uuid;
    this.options.id = this.id;
    this.options.images = [];
    this.options.content = _.map(this.options.content, function(content: ExtChapter, index) {
      if (!content.filename) {
        let titleSlug = uslug(removeDiacritics(content.title || "no title"));
        content.href = index + "_" + titleSlug + ".xhtml";
        content.filePath = path.resolve(self.uuid, "./OEBPS/" + index + "_" + titleSlug + ".xhtml");
      } else {
        content.href = content.filename.match(/\.xhtml$/) ? content.filename : content.filename + ".xhtml";
        if (content.filename.match(/\.xhtml$/)) {
          content.filePath = path.resolve(self.uuid, "./OEBPS/" + content.filename);
        } else {
          content.filePath = path.resolve(self.uuid, "./OEBPS/" + content.filename + ".xhtml");
        }
      }
      content.id = "item_" + index;
      content.dir = path.dirname(content.filePath);
      content.excludeFromToc || (content.excludeFromToc = false);
      content.beforeToc || (content.beforeToc = false);
      content.author = content.author && _.isString(content.author) ? [content.author] : !content.author || !_.isArray(content.author) ? [] : content.author;
      if (options.trustContent) {
        return content;
      }
      const allowedAttributes = ["content", "alt", "id", "title", "src", "href", "about", "accesskey", "aria-activedescendant", "aria-atomic", "aria-autocomplete", "aria-busy", "aria-checked", "aria-controls", "aria-describedat", "aria-describedby", "aria-disabled", "aria-dropeffect", "aria-expanded", "aria-flowto", "aria-grabbed", "aria-haspopup", "aria-hidden", "aria-invalid", "aria-label", "aria-labelledby", "aria-level", "aria-live", "aria-multiline", "aria-multiselectable", "aria-orientation", "aria-owns", "aria-posinset", "aria-pressed", "aria-readonly", "aria-relevant", "aria-required", "aria-selected", "aria-setsize", "aria-sort", "aria-valuemax", "aria-valuemin", "aria-valuenow", "aria-valuetext", "class", "content", "contenteditable", "contextmenu", "datatype", "dir", "draggable", "dropzone", "height", "hidden", "hreflang", "id", "inlist", "itemid", "itemref", "itemscope", "itemtype", "lang", "media", "ns1:type", "ns2:alphabet", "ns2:ph", "onabort", "onblur", "oncanplay", "oncanplaythrough", "onchange", "onclick", "oncontextmenu", "ondblclick", "ondrag", "ondragend", "ondragenter", "ondragleave", "ondragover", "ondragstart", "ondrop", "ondurationchange", "onemptied", "onended", "onerror", "onfocus", "oninput", "oninvalid", "onkeydown", "onkeypress", "onkeyup", "onload", "onloadeddata", "onloadedmetadata", "onloadstart", "onmousedown", "onmousemove", "onmouseout", "onmouseover", "onmouseup", "onmousewheel", "onpause", "onplay", "onplaying", "onprogress", "onratechange", "onreadystatechange", "onreset", "onscroll", "onseeked", "onseeking", "onselect", "onshow", "onstalled", "onsubmit", "onsuspend", "ontimeupdate", "onvolumechange", "onwaiting", "prefix", "property", "rel", "resource", "rev", "role", "spellcheck", "style", "tabindex", "target", "title", "type", "typeof", "vocab", "width", "xml:base", "xml:lang", "xml:space", "colspan", "rowspan"];
      const allowedXhtml11Tags = ["div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd", "address", "hr", "pre", "blockquote", "center", "ins", "del", "a", "span", "bdo", "br", "em", "strong", "dfn", "code", "samp", "kbd", "bar", "cite", "abbr", "acronym", "q", "sub", "sup", "tt", "i", "b", "big", "small", "u", "s", "strike", "basefont", "font", "object", "param", "img", "table", "caption", "colgroup", "col", "thead", "tfoot", "tbody", "tr", "th", "td", "embed", "applet", "iframe", "img", "map", "noscript", "ns:svg", "object", "script", "table", "tt", "var"];
      var $ = cheerio.load(content.data, <any>{
        lowerCaseTags: true,
        ignoreWhitespace: true,
        recognizeSelfClosing: true
      });
      if ($("body").length) {
        $ = cheerio.load($("body").html(), <any>{
          lowerCaseTags: true,
          ignoreWhitespace: true,
          recognizeSelfClosing: true
        });
      }
      $($("*").get().reverse()).each(function(this: Element,elemIndex, elem) {
        let attrs = elem.attribs;
        let elemName = this.tagName;
        if (elemName === "img" || elemName === "br" || elemName === "hr") {
          $(this).text("");
          if (this.tagName === "img") {
            $(this).attr("alt", $(this).attr("alt") || "image-placeholder");
          }
        }
        for (let k in attrs) {
          let v = (<any>attrs)[k];
          if (allowedAttributes.indexOf(k) >= 0) {
            if (k === "type") {
              if (this.tagName !== "script") {
                $(this).removeAttr(k);
              }
            }
          } else {
            $(this).removeAttr(k);
          }
        }
        if (self.options.version === 2) {
          if (allowedXhtml11Tags.indexOf(this.tagName) >= 0) {
          } else {
            console.log("Warning (content[" + index + "]):", this.tagName, "tag isn't allowed on EPUB 2/XHTML 1.1 DTD.");
            let child = $(this).html();
            return $(this).replaceWith($("<div>" + child + "</div>"));
          }
        }
      });
      $("img").each(function(this: HTMLElement, index, elem) {
        let url = $(elem).attr("src");
        let id = uuid();
        let mediaType = mime.lookup(url);
        let extension = mime.extension(mediaType);
        $(elem).attr("src", "images/" + id + "." + extension);
        let dir = content.dir;
        return self.options.images.push({
          id: id,
          url: url,
          dir: dir,
          mediaType: mediaType,
          extension: extension
        });
      });
      content.data = $.xml();
      return content;
    });
    if (this.options.cover) {
      this.options._coverMediaType = mime.lookup(this.options.cover);
      this.options._coverExtension = mime.extension(this.options._coverMediaType);
    }
    this.promise = this.render();
  }

  private async render(): Promise<void> {
    console.log("Generating Template Files.....");
    await this.generateTempFile();
    console.log("Downloading Images...");
    await this.downloadAllImages();
    console.log("Making Cover...");
    await this.makeCover();
    console.log("Generating Epub Files...");
    await this.genEpub();
  }

  private async generateTempFile(): Promise<void> {
    if (!await fs.exists(this.options.tempDir)) {
      await fs.mkdir(this.options.tempDir);
    }
    await fs.mkdir(this.uuid);
    await fs.mkdir(path.resolve(this.uuid, "./OEBPS"));
    if (!this.options.css) {
      this.options.css = await fs.readFile(path.resolve(__dirname, "./templates/template.css"), "utf8");
    }
    await fs.writeFile(path.resolve(this.uuid, "./OEBPS/style.css"), this.options.css);
    if (this.options.fonts.length) {
      await fs.mkdir(path.resolve(this.uuid, "./OEBPS/fonts"));
      this.options.fonts = await Promise.all(_.map(this.options.fonts, async (font) => {
        var filename;
        if (!await fs.exists(font)) {
          throw new Error('Custom font not found at ' + font + '.');
        }
        filename = path.basename(font);
        await fs.copy(font, path.resolve(this.uuid, "./OEBPS/fonts/" + filename));
        return filename;
      }));
    }
    await Promise.all(_.map(this.options.content, async (content: ExtChapter) => {
      var data;
      data = this.options.docHeader + "\n  <head>\n  <meta charset=\"UTF-8\" />\n  <title>" + (entities.encodeXML(content.title || '')) + "</title>\n  <link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\" />\n  </head>\n<body>";
      data += content.title && this.options.appendChapterTitles ? "<h1>" + (entities.encodeXML(content.title)) + "</h1>" : "";
      data += content.title && content.author && content.author.length ? "<p class='epub-author'>" + (entities.encodeXML((content.author as string[]).join(", "))) + "</p>" : "";
      data += content.title && content.url ? "<p class='epub-link'><a href='" + content.url + "'>" + content.url + "</a></p>" : "";
      data += content.data + "</body></html>";
      return await fs.writeFile(content.filePath, data);
    }));
    await fs.writeFile(this.uuid + "/mimetype", "application/epub+zip");
    await fs.mkdir(this.uuid + "/META-INF");
    await fs.writeFile(this.uuid + "/META-INF/container.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" ?><container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"><rootfiles><rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles></container>");
    if (this.options.version === 2) {
      await fs.writeFile(this.uuid + "/META-INF/com.apple.ibooks.display-options.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<display_options>\n  <platform name=\"*\">\n    <option name=\"specified-fonts\">true</option>\n  </platform>\n</display_options>");
    }
    let opfPath = this.options.customOpfTemplatePath || path.resolve(__dirname, "./templates/epub" + this.options.version + "/content.opf.ejs");
    if (!await fs.exists(opfPath)) {
      throw new Error('Custom file to OPF template not found.');
    }
    let ncxTocPath = this.options.customNcxTocTemplatePath || path.resolve(__dirname, "./templates/toc.ncx.ejs");
    if (!await fs.exists(ncxTocPath)) {
      throw new Error('Custom file the NCX toc template not found.');
    }
    let htmlTocPath = this.options.customHtmlTocTemplatePath || path.resolve(__dirname, "./templates/epub" + this.options.version + "/toc.xhtml.ejs");
    if (!await fs.exists(htmlTocPath)) {
      throw new Error('Custom file to HTML toc template not found.');
    }

    function renderFile(path: string, data: any): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        ejs.renderFile(path, data, (err, result) => {
          if (err) { reject(err); }
          resolve(result);
        });
      });
    }

    await Promise.all([
      (async () => {
        let content = await renderFile(opfPath, this.options);
        await fs.writeFile(path.resolve(this.uuid, "./OEBPS/content.opf"), content);
      })(),
      (async () => {
        let content = await renderFile(ncxTocPath, this.options);
        await fs.writeFile(path.resolve(this.uuid, "./OEBPS/toc.ncx"), content);
      })(),
      (async () => {
        let content = await renderFile(htmlTocPath, this.options);
        await fs.writeFile(path.resolve(this.uuid, "./OEBPS/toc.xhtml"), content);
      })()
    ]);
  }

  private async makeCover() {
    if (this.options.cover) {
      let destPath = path.resolve(this.uuid, "./OEBPS/cover." + this.options._coverExtension);
      await this.host.downloadFile(this.options.cover, destPath);
    }
  }

  private async downloadAllImages() {
    if (!this.options.images.length) {
      return;
    } else {
      await fs.mkdir(path.resolve(this.uuid, "./OEBPS/images"));
      await Promise.all(_.map(this.options.images, async (image) => {
        await this.downloadImage(image);
      }));
    }
  }
  
  private async downloadImage(image: Image) {
    let filename = path.resolve(this.uuid, "./OEBPS/images/" + image.id + "." + image.extension);
    await this.host.downloadFile(image.url, filename);
  }

  private genEpub() {
    return new Promise<void>((resolve, reject) => {
      let cwd = this.uuid;
      let archive: archiver.Archiver & {
        file(path: string, name: archiver.nameInterface): void;
      } = archiver("zip", {
        zlib: {
          level: 9
        }
      }) as any;
      let output = fs.createWriteStream(this.options.output);
      console.log("Zipping temp dir to", this.options.output);
      archive.file(cwd + "/mimetype", <any>{
        store: true,
        name: "mimetype"
      });
      archive.directory(cwd + "/META-INF", "META-INF");
      archive.directory(cwd + "/OEBPS", "OEBPS");
      archive.pipe(output);
      archive.on("end", function() {
        console.log("Done zipping, clearing temp dir...");
        return rimraf(cwd, function(err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      archive.on("error", function(err: any) {
        reject(err);
      });
      archive.finalize();
    });
  }
}
