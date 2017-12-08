"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path = require("path");
const fs = require("fs-promise");
const _ = require("underscore");
const ejs = require("ejs");
const cheerio = require("cheerio");
const request = require("request");
const mime = require("mime");
const archiver = require("archiver");
const rimraf = require("rimraf");
var uslug = require("uslug");
var entities = require("entities");
var removeDiacritics = require("diacritics").remove;
var delay = require("promise-delay");
var Bottleneck = require("bottleneck");
Bottleneck.prototype.Promise = require("any-promise");
Promise = require("any-promise");
function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r;
        r = Math.random() * 16 | 0;
        return (c === 'x' ? r : r & 0x3 | 0x8).toString(16);
    });
}
class Host {
    constructor() {
        this.limiter = new Bottleneck(5, 0, -1, null, true);
    }
    downloadFile(url, path) {
        return this.limiter.schedule((url, path) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            var times = 0;
            var retryLimit = 5;
            console.log(`Get: ${url}`);
            while (true) {
                try {
                    yield this.tryDownloadFile(url, path);
                    console.log(`Done: ${url}`);
                    return;
                }
                catch (err) {
                    times++;
                    if (times >= retryLimit) {
                        throw err;
                    }
                    else {
                        console.error(`Retry ${times}: `, url);
                        yield delay(1000);
                    }
                }
            }
        }), url, path);
    }
    tryDownloadFile(url, path) {
        return new Promise((resolve, reject) => {
            const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/34.0.1847.116 Safari/537.36";
            var called = false;
            function cb(err) {
                if (!called) {
                    called = true;
                    if (err) {
                        reject(err);
                    }
                    else {
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
            }
            else if (url.slice(0, 4) === "file") {
                url = url.slice(8);
                readStream = fs.createReadStream(url);
            }
            else {
                readStream = fs.createReadStream(url);
            }
            let writeStream = fs.createWriteStream(path);
            readStream.on("error", cb);
            writeStream.on("error", cb);
            writeStream.on("close", () => cb());
            readStream.pipe(writeStream);
        });
    }
}
class EPub {
    constructor(options, output, host = new Host()) {
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
        this.options = Object.assign({ description: options.title, publisher: "anonymous", author: ["anonymous"], tocTitle: "Table Of Contents", appendChapterTitles: true, date: new Date().toISOString(), lang: "en", fonts: [], customOpfTemplatePath: null, customNcxTocTemplatePath: null, customHtmlTocTemplatePath: null, version: 3 }, options);
        if (this.options.version === 2) {
            this.options.docHeader = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.1//EN\" \"http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd\">\n<html xmlns=\"http://www.w3.org/1999/xhtml\" lang=\"" + self.options.lang + "\">";
        }
        else {
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
        this.options.content = _.map(this.options.content, function (content, index) {
            if (!content.filename) {
                let titleSlug = uslug(removeDiacritics(content.title || "no title"));
                content.href = index + "_" + titleSlug + ".xhtml";
                content.filePath = path.resolve(self.uuid, "./OEBPS/" + index + "_" + titleSlug + ".xhtml");
            }
            else {
                content.href = content.filename.match(/\.xhtml$/) ? content.filename : content.filename + ".xhtml";
                if (content.filename.match(/\.xhtml$/)) {
                    content.filePath = path.resolve(self.uuid, "./OEBPS/" + content.filename);
                }
                else {
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
            const allowedAttributes = ["content", "alt", "id", "title", "src", "href", "about", "accesskey", "aria-activedescendant", "aria-atomic", "aria-autocomplete", "aria-busy", "aria-checked", "aria-controls", "aria-describedat", "aria-describedby", "aria-disabled", "aria-dropeffect", "aria-expanded", "aria-flowto", "aria-grabbed", "aria-haspopup", "aria-hidden", "aria-invalid", "aria-label", "aria-labelledby", "aria-level", "aria-live", "aria-multiline", "aria-multiselectable", "aria-orientation", "aria-owns", "aria-posinset", "aria-pressed", "aria-readonly", "aria-relevant", "aria-required", "aria-selected", "aria-setsize", "aria-sort", "aria-valuemax", "aria-valuemin", "aria-valuenow", "aria-valuetext", "class", "content", "contenteditable", "contextmenu", "datatype", "dir", "draggable", "dropzone", "hidden", "hreflang", "id", "inlist", "itemid", "itemref", "itemscope", "itemtype", "lang", "media", "ns1:type", "ns2:alphabet", "ns2:ph", "onabort", "onblur", "oncanplay", "oncanplaythrough", "onchange", "onclick", "oncontextmenu", "ondblclick", "ondrag", "ondragend", "ondragenter", "ondragleave", "ondragover", "ondragstart", "ondrop", "ondurationchange", "onemptied", "onended", "onerror", "onfocus", "oninput", "oninvalid", "onkeydown", "onkeypress", "onkeyup", "onload", "onloadeddata", "onloadedmetadata", "onloadstart", "onmousedown", "onmousemove", "onmouseout", "onmouseover", "onmouseup", "onmousewheel", "onpause", "onplay", "onplaying", "onprogress", "onratechange", "onreadystatechange", "onreset", "onscroll", "onseeked", "onseeking", "onselect", "onshow", "onstalled", "onsubmit", "onsuspend", "ontimeupdate", "onvolumechange", "onwaiting", "prefix", "property", "rel", "resource", "rev", "role", "spellcheck", "style", "tabindex", "target", "title", "type", "typeof", "vocab", "xml:base", "xml:lang", "xml:space", "colspan", "rowspan"];
            const allowedXhtml11Tags = ["div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd", "address", "hr", "pre", "blockquote", "center", "ins", "del", "a", "span", "bdo", "br", "em", "strong", "dfn", "code", "samp", "kbd", "bar", "cite", "abbr", "acronym", "q", "sub", "sup", "tt", "i", "b", "big", "small", "u", "s", "strike", "basefont", "font", "object", "param", "img", "table", "caption", "colgroup", "col", "thead", "tfoot", "tbody", "tr", "th", "td", "embed", "applet", "iframe", "img", "map", "noscript", "ns:svg", "object", "script", "table", "tt", "var"];
            var $ = cheerio.load(content.data, {
                lowerCaseTags: true,
                ignoreWhitespace: true,
                recognizeSelfClosing: true
            });
            if ($("body").length) {
                $ = cheerio.load($("body").html(), {
                    lowerCaseTags: true,
                    ignoreWhitespace: true,
                    recognizeSelfClosing: true
                });
            }
            $($("*").get().reverse()).each(function (elemIndex, elem) {
                let attrs = elem.attribs;
                let elemName = this.tagName;
                if (elemName === "img" || elemName === "br" || elemName === "hr") {
                    $(this).text("");
                    if (this.tagName === "img") {
                        $(this).attr("alt", $(this).attr("alt") || "image-placeholder");
                    }
                }
                for (let k in attrs) {
                    let v = attrs[k];
                    if (allowedAttributes.indexOf(k) >= 0) {
                        if (k === "type") {
                            if (this.tagName !== "script") {
                                $(this).removeAttr(k);
                            }
                        }
                    }
                    else {
                        $(this).removeAttr(k);
                    }
                }
                if (self.options.version === 2) {
                    if (allowedXhtml11Tags.indexOf(this.tagName) >= 0) {
                    }
                    else {
                        console.log("Warning (content[" + index + "]):", this.tagName, "tag isn't allowed on EPUB 2/XHTML 1.1 DTD.");
                        let child = $(this).html();
                        return $(this).replaceWith($("<div>" + child + "</div>"));
                    }
                }
            });
            $("img").each(function (index, elem) {
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
    render() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            console.log("Generating Template Files.....");
            yield this.generateTempFile();
            console.log("Downloading Images...");
            yield this.downloadAllImages();
            console.log("Making Cover...");
            yield this.makeCover();
            console.log("Generating Epub Files...");
            yield this.genEpub();
        });
    }
    generateTempFile() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!(yield fs.exists(this.options.tempDir))) {
                yield fs.mkdir(this.options.tempDir);
            }
            yield fs.mkdir(this.uuid);
            yield fs.mkdir(path.resolve(this.uuid, "./OEBPS"));
            if (!this.options.css) {
                this.options.css = yield fs.readFile(path.resolve(__dirname, "./templates/template.css"), "utf8");
            }
            yield fs.writeFile(path.resolve(this.uuid, "./OEBPS/style.css"), this.options.css);
            if (this.options.fonts.length) {
                yield fs.mkdir(path.resolve(this.uuid, "./OEBPS/fonts"));
                this.options.fonts = yield Promise.all(_.map(this.options.fonts, (font) => tslib_1.__awaiter(this, void 0, void 0, function* () {
                    var filename;
                    if (!(yield fs.exists(font))) {
                        throw new Error('Custom font not found at ' + font + '.');
                    }
                    filename = path.basename(font);
                    yield fs.copy(font, path.resolve(this.uuid, "./OEBPS/fonts/" + filename));
                    return filename;
                })));
            }
            yield Promise.all(_.map(this.options.content, (content) => tslib_1.__awaiter(this, void 0, void 0, function* () {
                var data;
                data = this.options.docHeader + "\n  <head>\n  <meta charset=\"UTF-8\" />\n  <title>" + (entities.encodeXML(content.title || '')) + "</title>\n  <link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\" />\n  </head>\n<body>";
                data += content.title && this.options.appendChapterTitles ? "<h1>" + (entities.encodeXML(content.title)) + "</h1>" : "";
                data += content.title && content.author && content.author.length ? "<p class='epub-author'>" + (entities.encodeXML(content.author.join(", "))) + "</p>" : "";
                data += content.title && content.url ? "<p class='epub-link'><a href='" + content.url + "'>" + content.url + "</a></p>" : "";
                data += content.data + "</body></html>";
                return yield fs.writeFile(content.filePath, data);
            })));
            yield fs.writeFile(this.uuid + "/mimetype", "application/epub+zip");
            yield fs.mkdir(this.uuid + "/META-INF");
            yield fs.writeFile(this.uuid + "/META-INF/container.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" ?><container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"><rootfiles><rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles></container>");
            if (this.options.version === 2) {
                yield fs.writeFile(this.uuid + "/META-INF/com.apple.ibooks.display-options.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<display_options>\n  <platform name=\"*\">\n    <option name=\"specified-fonts\">true</option>\n  </platform>\n</display_options>");
            }
            let opfPath = this.options.customOpfTemplatePath || path.resolve(__dirname, "./templates/epub" + this.options.version + "/content.opf.ejs");
            if (!(yield fs.exists(opfPath))) {
                throw new Error('Custom file to OPF template not found.');
            }
            let ncxTocPath = this.options.customNcxTocTemplatePath || path.resolve(__dirname, "./templates/toc.ncx.ejs");
            if (!(yield fs.exists(ncxTocPath))) {
                throw new Error('Custom file the NCX toc template not found.');
            }
            let htmlTocPath = this.options.customHtmlTocTemplatePath || path.resolve(__dirname, "./templates/epub" + this.options.version + "/toc.xhtml.ejs");
            if (!(yield fs.exists(htmlTocPath))) {
                throw new Error('Custom file to HTML toc template not found.');
            }
            function renderFile(path, data) {
                return new Promise((resolve, reject) => {
                    ejs.renderFile(path, data, (err, result) => {
                        if (err) {
                            reject(err);
                        }
                        resolve(result);
                    });
                });
            }
            yield Promise.all([
                (() => tslib_1.__awaiter(this, void 0, void 0, function* () {
                    let content = yield renderFile(opfPath, this.options);
                    yield fs.writeFile(path.resolve(this.uuid, "./OEBPS/content.opf"), content);
                }))(),
                (() => tslib_1.__awaiter(this, void 0, void 0, function* () {
                    let content = yield renderFile(ncxTocPath, this.options);
                    yield fs.writeFile(path.resolve(this.uuid, "./OEBPS/toc.ncx"), content);
                }))(),
                (() => tslib_1.__awaiter(this, void 0, void 0, function* () {
                    let content = yield renderFile(htmlTocPath, this.options);
                    yield fs.writeFile(path.resolve(this.uuid, "./OEBPS/toc.xhtml"), content);
                }))()
            ]);
        });
    }
    makeCover() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (this.options.cover) {
                let destPath = path.resolve(this.uuid, "./OEBPS/cover." + this.options._coverExtension);
                yield this.host.downloadFile(this.options.cover, destPath);
            }
        });
    }
    downloadAllImages() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!this.options.images.length) {
                return;
            }
            else {
                yield fs.mkdir(path.resolve(this.uuid, "./OEBPS/images"));
                yield Promise.all(_.map(this.options.images, (image) => tslib_1.__awaiter(this, void 0, void 0, function* () {
                    yield this.downloadImage(image);
                })));
            }
        });
    }
    downloadImage(image) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let filename = path.resolve(this.uuid, "./OEBPS/images/" + image.id + "." + image.extension);
            yield this.host.downloadFile(image.url, filename);
        });
    }
    genEpub() {
        return new Promise((resolve, reject) => {
            let cwd = this.uuid;
            let archive = archiver("zip", {
                zlib: {
                    level: 9
                }
            });
            let output = fs.createWriteStream(this.options.output);
            console.log("Zipping temp dir to", this.options.output);
            archive.file(cwd + "/mimetype", {
                store: true,
                name: "mimetype"
            });
            archive.directory(cwd + "/META-INF", "META-INF");
            archive.directory(cwd + "/OEBPS", "OEBPS");
            archive.pipe(output);
            archive.on("end", function () {
                console.log("Done zipping, clearing temp dir...");
                return rimraf(cwd, function (err) {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve();
                    }
                });
            });
            archive.on("error", function (err) {
                reject(err);
            });
            archive.finalize();
        });
    }
}
exports.default = EPub;
//# sourceMappingURL=index.js.map