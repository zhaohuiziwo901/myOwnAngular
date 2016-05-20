function Scope() {
    this.$$watchers = [];
    this.$$lastDirtyWatch = null;
    this.$$asyncQueue = [];
    this.$$applyAsyncQueue = [];
    this.$$applyAsyncId = null;
    this.$$postDigestQueue = [];
    this.$root = this;
    this.$$children = [];
    this.$$listeners = {};
    this.$$phase = null;
}
Scope.prototype.$watch = function (watchFn, listenerFn, valueEq) {
    var self = this;
    var watcher = {
        watchFn: watchFn,
        listenerFn: listenerFn || function () { },
        valueEq: !!valueEq,
        last: initWatchVal
    };
    this.$$watchers.unshift(watcher);
    this.$root.$$lastDirtyWatch = null;
    return function () {
        var index = self.$$watchers.indexOf(watcher);
        if (index >= 0) {
            self.$$watchers.splice(index, 1);
            self.$root.$$lastDirtyWatch = null;
        }
    };
};
Scope.prototype.$$digestOnce = function () {
    var self = this;
    var dirty;
    var continueLoop = true;
    this.$$everyScope(function (scope) {
        var newValue, oldValue;
        _.forEachRight(scope.$$watchers, function (watcher) {
            try {
                if (watcher) {
                    newValue = watcher.watchFn(scope);
                    oldValue = watcher.last;
                    if (!scope.$$areEqual(newValue, oldValue, watcher.valueEq)) {
                        scope.$root.$$lastDirtyWatch = watcher;
                        watcher.last = (watcher.valueEq ? _.cloneDeep(newValue) : newValue);
                        watcher.listenerFn(newValue,
                            (oldValue === initWatchVal ? newValue : oldValue),
                            scope);
                        dirty = true;
                    } else if (scope.$root.$$lastDirtyWatch === watcher) {
                        continueLoop = false;
                        return false;
                    }
                }
            } catch (e) {
                console.error(e);
            }
        });
        return continueLoop;
    });
    return dirty;
};
Scope.prototype.$digest = function () {
    var ttl = 10;
    var dirty;
    this.$root.$$lastDirtyWatch = null;
    this.$beginPhase("$digest");

    if (this.$root.$$applyAsyncId) {
        clearTimeout(this.$root.$$applyAsyncId);
        this.$$flushApplyAsync();
    }

    do {
        while (this.$$asyncQueue.length) {
            try {
                var asyncTask = this.$$asyncQueue.shift();
                asyncTask.scope.$eval(asyncTask.expression);
            } catch (e) {
                console.error(e);
            }
        }
        dirty = this.$$digestOnce();
        if ((dirty || this.$$asyncQueue.length) && !(ttl--)) {
            this.$clearPhase();
            throw "10 digest iterations reached";
        }
    } while (dirty || this.$$asyncQueue.length);
    this.$clearPhase();

    while (this.$$postDigestQueue.length) {
        try {
            this.$$postDigestQueue.shift()();
        } catch (e) {
            console.error(e);
        }
    }
};
Scope.prototype.$$areEqual = function (newValue, oldValue, valueEq) {
    if (valueEq) {
        return _.isEqual(newValue, oldValue);
    } else {
        return newValue === oldValue ||
            (typeof newValue === "number" && typeof oldValue === "number" &&
            isNaN(newValue) && isNaN(oldValue));
    }
};
Scope.prototype.$eval = function (expr, locals) {
    return expr(this, locals);
};
Scope.prototype.$apply = function (expr) {
    try {
        this.$beginPhase("$apply");
        return this.$eval(expr);
    } finally {
        this.$clearPhase();
        this.$root.$digest();
    }
};
Scope.prototype.$evalAsync = function (expr) {
    var self = this;
    if (!self.$$phase && !self.$$asyncQueue.length) {
        setTimeout(function () {
            if (self.$$asyncQueue.length) {
                self.$root.$digest();
            }
        }, 0);
    }
    this.$$asyncQueue.push({
        scope: this,
        expression: expr
    });
};
Scope.prototype.$applyAsync = function (expr) {
    var self = this;
    self.$$applyAsyncQueue.push(function () {
        self.$eval(expr);
    });
    if (self.$root.$$applyAsyncId === null) {
        self.$root.$$applyAsyncId = setTimeout(function () {
            self.$apply(_.bind(self.$$flushApplyAsync, self));
        }, 0);
    }
};
Scope.prototype.$$flushApplyAsync = function () {
    while (this.$$applyAsyncQueue.length) {
        try {
            this.$$applyAsyncQueue.shift()();
        } catch (e) {
            console.error(e);
        }
    }
    this.$root.$$applyAsyncId = null;
};
Scope.prototype.$$postDigest = function (fn) {
    this.$$postDigestQueue.push(fn);
};
Scope.prototype.$watchGroup = function (watchFns, listenerFn) {
    var self = this;
    var newValues = new Array(watchFns.length);
    var oldValues = new Array(watchFns.length);
    var changeReactionScheduled = false;
    var firstRun = true;

    if (watchFns.length === 0) {
        var shouldCall = true;
        self.$evalAsync(function () {
            if (shouldCall) {
                listenerFn(newValues, newValues, self);
            }
        });
        return function () {
            shouldCall = false;
        };
    }

    function watchGroupListener() {
        if (firstRun) {
            firstRun = false;
            listenerFn(newValues, newValues, self);
        } else {
            listenerFn(newValues, oldValues, self);
        }
        changeReactionScheduled = true;
    }

    var destroyFunctions = _.map(watchFns, function (watchFn, i) {
        return self.$watch(watchFn, function (newValue, oldValue) {
            newValues[i] = newValue;
            oldValues[i] = oldValue;
            if (!changeReactionScheduled) {
                changeReactionScheduled = true;
                self.$evalAsync(watchGroupListener);
            }
        });
    });

    return function () {
        _.forEach(destroyFunctions, function (destroyFunction) {
            destroyFunction();
        });
    };
};
Scope.prototype.$new = function (isolated, parent) {
    var child;
    parent = parent || this;
    if (isolated) {
        child = new Scope();
        child.$root = parent.$root;
        child.$$asyncQueue = parent.$$asyncQueue;
        child.$$postDigestQueue = parent.$$postDigestQueue;
        child.$$applyAsyncQueue = parent.$$applyAsyncQueue;
    } else {
        var ChildScope = function () { };
        ChildScope.prototype = this;
        child = new ChildScope();
    }
    parent.$$children.push(child);
    child.$$watchers = [];
    child.$$listeners = {};
    child.$$children = [];
    child.$parent = parent;
    return child;
};
Scope.prototype.$$everyScope = function (fn) {
    if (fn(this)) {
        return this.$$children.every(function (child) {
            return child.$$everyScope(fn);
        });
    } else {
        return false;
    }
};
Scope.prototype.$destroy = function () {
    this.$broadcast("$destroy");
    if (this.$parent) {
        var siblings = this.$parent.$$children;
        var indexOfThis = siblings.indexOf(this);
        if (indexOfThis >= 0) {
            siblings.splice(indexOfThis, 1);
        }
    }
    this.$$watchers = null;
    this.$$listeners = {};
};
Scope.prototype.$watchCollection = function (watchFn, listenerFn) {
    var self = this;
    var newValue;
    var oldValue;
    var oldLength;
    var veryOldValue;
    var trackVeryOldValue = (listenerFn.length > 1);
    var changeCount = 0;
    var firstRun = true;
    var internalWatchFn = function (scope) {
        var newLength;
        newValue = watchFn(scope);
        if (_.isObject(newValue)) {
            if (_.isArrayLike(newValue)) {
                if (!_.isArray(oldValue)) {
                    changeCount++;
                    oldValue = [];
                }
                if (newValue.length !== oldValue.length) {
                    changeCount++;
                    oldValue.length = newValue.length;
                }
                _.forEach(newValue, function (newItem, i) {
                    var bothNaN = _.isNaN(newItem) && _.isNaN(oldValue[i]);
                    if (!bothNaN && newItem !== oldValue[i]) {
                        changeCount++;
                        oldValue[i] = newItem;
                    }
                });
            } else {
                if (!_.isObject(oldValue) || _.isArrayLike(oldValue)) {
                    changeCount++;
                    oldValue = {};
                    oldLength = 0;
                }
                newLength = 0;
                _.forOwn(newValue, function (newVal, key) {
                    newLength++;
                    if (oldValue.hasOwnProperty(key)) {
                        var bothNaN = _.isNaN(newVal) && _.isNaN(oldValue[key]);
                        if (!bothNaN && oldValue[key] !== newVal) {
                            changeCount++;
                            oldValue[key] = newVal;
                        }
                    } else {
                        changeCount++;
                        oldLength++;
                        oldValue[key] = newVal;
                    }
                });
                if (oldLength > newLength) {
                    changeCount++;
                    _.forOwn(oldValue, function (oldVal, key) {
                        if (!newValue.hasOwnProperty(key)) {
                            changeCount--;
                            delete oldValue[key];
                        }
                    });
                }
            }
        } else {
            if (!self.$$areEqual(newValue, oldValue, false)) {
                changeCount++;
            }
            oldValue = newValue;
        }
        return changeCount;
    };
    var internalListenerFn = function () {
        if (firstRun) {
            listenerFn(newValue, oldValue, self);
            firstRun = false;
        } else {
            listenerFn(newValue, veryOldValue, self);
        }

        if (trackVeryOldValue) {
            veryOldValue = _.clone(newValue);
        }
    };
    return this.$watch(internalWatchFn, internalListenerFn);
};
Scope.prototype.$on = function (eventName, listener) {
    var listeners = this.$$listeners[eventName];
    if (!listeners) {
        this.$$listeners[eventName] = listeners = [];
    }
    listeners.push(listener);
    return function () {
        var index = listeners.indexOf(listener);
        if (index >= 0) {
            listeners[index] = null;
        }
    };
};
Scope.prototype.$emit = function (eventName) {
    var propagationStopped = false;
    var event = {
        name: eventName,
        targetScope: this,
        stopPropagation: function () {
            propagationStopped = true;
        },
        preventDefault: function () {
            event.defaultPrevented = true;
        }
    };
    var listenerArgs = [event].concat(_.rest(arguments));
    var scope = this;
    do {
        event.currentScope = scope;
        scope.$$fireEventOnScope(eventName, listenerArgs);
        scope = scope.$parent;
    } while (scope && !propagationStopped);
    event.currentScope = null;
    return event;
};
Scope.prototype.$broadcast = function (eventName) {
    var event = {
        name: eventName,
        targetScope: this,
        preventDefault: function () {
            event.defaultPrevented = true;
        }
    };
    var listenerArgs = [event].concat(_.rest(arguments));
    this.$$everyScope(function (scope) {
        event.currentScope = scope;
        scope.$$fireEventOnScope(eventName, listenerArgs);
        return true;
    });
    event.currentScope = null;
    return event;
};
Scope.prototype.$$fireEventOnScope = function (eventName, additionalArgs) {
    var event = { name: eventName };
    var listenerArgs = [event].concat(additionalArgs);
    var listeners = this.$$listeners[eventName] || [];
    var i = 0;
    while (i < listeners.length) {
        if (listeners[i] == null) {
            listeners.splice(i, 1);
        } else {
            try {
                listeners[i].apply(null, listenerArgs);
            } catch (e) {
                console.error(e);
            }
            i++;
        }
    }
    return event;
};

function initWatchVal() { }

//compile
var ESCAPES = {
    "n": "\n",
    "f": "\f",
    "r": "\r",
    "t": "\t",
    "v": "\v",
    "'": "'",
    "\"": "\""
};
var OPERATORS = {
    "+": true,
    "!": true,
    "-": true,
    "*": true,
    "/": true,
    "%": true,
    "=": true,
    "==": true,
    "!=": true,
    "===": true,
    "!==": true,
    "<": true,
    ">": true,
    "<=": true,
    ">=": true,
    "&&": true,
    "||": true
};
function parse(expr) {
    var lexer = new Lexer();
    var parser = new Parser(lexer);
    return parser.parse(expr);
}
function Lexer() {

}
Lexer.prototype.lex = function (text) {
    this.text = text;
    this.index = 0;
    this.ch = undefined;
    this.tokens = [];
    while (this.index < this.text.length) {
        this.ch = this.text.charAt(this.index);
        if (this.isNumber(this.ch) || (this.is(".") && this.isNumber(this.peek()))) {
            this.readNumber();
        } else if (this.is("\"'")) {
            this.readString(this.ch);
        } else if (this.is("[],{}:.()?;")) {
            this.tokens.push({
                text: this.ch
            });
            this.index++;
        } else if (this.isIdent(this.ch)) {
            this.readIdent();
        } else if (this.isWhiteSpace(this.ch)) {
            this.index++;
        } else {
            var ch = this.ch;
            var ch2 = this.ch + this.peek();
            var ch3 = this.ch + this.peek() + this.peek(2);
            var op = OPERATORS[ch];
            var op2 = OPERATORS[ch2];
            var op3 = OPERATORS[ch3];
            if (op || op2 || op3) {
                var token = op3 ? ch3 : (op2 ? ch2 : ch);
                this.tokens.push({ text: token });
                this.index += token.length;
            } else {
                throw "unexpected next charactor: " + this.ch;
            }
        }
    }
    return this.tokens;
};
Lexer.prototype.is = function (chs) {
    return chs.indexOf(this.ch) >= 0;
};
Lexer.prototype.isNumber = function (ch) {
    return '0' <= ch && ch <= '9';
};
Lexer.prototype.readNumber = function () {
    var number = "";
    while (this.index < this.text.length) {
        var ch = this.text.charAt(this.index).toLowerCase();
        if (ch === "." || this.isNumber(ch)) {
            number += ch;
        } else {
            var nextCh = this.peek();
            var prevCh = number.charAt(number.length - 1);
            if (ch === "e" && this.isExpOperator(nextCh)) {
                number += ch;
            } else if (this.isExpOperator(ch) && prevCh === "e" && nextCh && this.isNumber(nextCh)) {
                number += ch;
            } else if (this.isExpOperator(ch) && prevCh === "e" && (!nextCh && !this.isNumber(nextCh))) {
                throw "Invalid exponent";
            } else {
                break;
            }
        }
        this.index++;
    }
    this.tokens.push({
        text: number,
        value: Number(number)
    });
};
Lexer.prototype.readString = function (quote) {
    this.index++;
    var string = "";
    var rawString = quote;
    var escape = false;
    while (this.index < this.text.length) {
        var ch = this.text.charAt(this.index);
        rawString += ch;
        if (escape) {
            if (ch === "u") {
                var hex = this.text.substring(this.index + 1, this.index + 5);
                if (!hex.match(/[\da-f]{4}/i)) {
                    throw "Invalid unicode escape";
                }
                this.index += 4;
                string += String.fromCharCode(parseInt(hex, 16));
            } else {
                var replacement = ESCAPES[ch];
                if (replacement) {
                    string += replacement;
                } else {
                    string += ch;
                }
            }
            escape = false;
        } else if (ch === quote) {
            this.index++;
            this.tokens.push({
                text: rawString,
                value: string
            });
            return;
        } else if (ch === "\\") {
            escape = true;
        } else {
            string += ch;
        }
        this.index++;
    }
    throw "Unmatched quote";
};
Lexer.prototype.peek = function (n) {
    n = n || 1;
    return this.index + n < this.text.length ? this.text.charAt(this.index + n) : false;
};
Lexer.prototype.isExpOperator = function (ch) {
    return ch === "-" || ch === "+" || this.isNumber(ch);
};
Lexer.prototype.isIdent = function (ch) {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch === "_") || (ch === "$");
};
Lexer.prototype.readIdent = function () {
    var text = "";
    while (this.index < this.text.length) {
        var ch = this.text.charAt(this.index);
        if (this.isIdent(ch) || this.isNumber(ch)) {
            text += ch;
        } else {
            break;
        }
        this.index++;
    }
    var token = {
        text: text,
        identifier: true
    };
    this.tokens.push(token);
};
Lexer.prototype.isWhiteSpace = function (ch) {
    return ch === " " || ch === "\r" || ch === "\t" || ch === "\n" || ch === "\v" || ch === "\u00A0";
};
function AST(lexer) {
    this.lexer = lexer;
}
AST.Program = "Program";
AST.Literal = "Literal";
AST.ArrayExpression = "ArrayExpression";
AST.ObjectExpression = "ObjectExpression";
AST.Property = "Property";
AST.Identifier = "Identifier";
AST.ThisExpression = "ThisExpression";
AST.MemberExpression = "MemberExpression";
AST.CallExpression = "CallExpression";
AST.AssignmentExpression = "AssignmentExpression";
AST.UnaryExpression = "UnaryExpression";
AST.BinaryExpression = "BinaryExpression";
AST.LogicalExpression = "LogicalExpression";
AST.ConditionalExpression = "ConditionalExpression";
AST.prototype.ast = function (text) {
    this.tokens = this.lexer.lex(text);
    return this.program();
};
AST.prototype.program = function () {
    var body = [];
    while (true) {
        if (this.tokens.length) {
            body.push(this.assignment());
        }
        if (!this.expect(";")) {
            return {
                type: AST.Program,
                body: body
            };
        }
    }
};
AST.prototype.primary = function () {
    var primary;
    if (this.expect("(")) {
        primary = this.assignment();
        this.consume(")");
    } else if (this.expect("[")) {
        primary = this.arrayDeclaration();
    } else if (this.expect("{")) {
        primary = this.object();
    } else if (this.constants.hasOwnProperty(this.tokens[0].text)) {
        primary = this.constants[this.consume().text];
    } else if (this.peek().identifier) {
        primary = this.identifier();
    } else {
        primary = this.constant();
    }
    var next;
    while (next = this.expect(".", "[", "(")) {
        if (next.text === "[") {
            primary = {
                type: AST.MemberExpression,
                object: primary,
                property: this.primary(),
                computed: true
            };
            this.consume("]");
        } else if (next.text === ".") {
            primary = {
                type: AST.MemberExpression,
                object: primary,
                property: this.identifier(),
                computed: false
            };
        } else if (next.text === "(") {
            primary = {
                type: AST.CallExpression,
                callee: primary,
                arguments: this.parseArguments()
            };
            this.consume(")");
        }
    }
    return primary;
};
AST.prototype.constant = function () {
    return {
        type: AST.Literal,
        value: this.consume().value
    };
};
AST.prototype.constants = {
    "null": {
        type: AST.Literal,
        value: null
    },
    "true": {
        type: AST.Literal,
        value: true
    },
    "false": {
        type: AST.Literal,
        value: false
    },
    "this": {
        type: AST.ThisExpression
    }
};
AST.prototype.arrayDeclaration = function () {
    var elements = [];
    if (!this.peek("]")) {
        do {
            if (this.peek("]")) {
                break;
            }
            elements.push(this.assignment());
        } while (this.expect(","));
    }
    this.consume("]");
    return {
        type: AST.ArrayExpression,
        elements: elements
    };
};
AST.prototype.object = function () {
    var properties = [];
    if (!this.peek("}")) {
        do {
            var property = {
                type: AST.Property
            };
            if (this.peek().identifier) {
                property.key = this.identifier();
            } else {
                property.key = this.constant();
            }
            this.consume(":");
            property.value = this.assignment();
            properties.push(property);
        } while (this.expect(","));
    }
    this.consume("}");
    return {
        type: AST.ObjectExpression,
        properties: properties
    };
};
AST.prototype.identifier = function () {
    return {
        type: AST.Identifier,
        name: this.consume().text
    };
};
AST.prototype.expect = function (e1, e2, e3, e4) {
    var token = this.peek(e1, e2, e3, e4);
    if (token) {
        return this.tokens.shift();
    }
};
AST.prototype.consume = function (e) {
    var token = this.expect(e);
    if (!token) {
        throw "unexpected . expecting " + e;
    }
    return token;
};
AST.prototype.peek = function (e1, e2, e3, e4) {
    if (this.tokens.length > 0) {
        var text = this.tokens[0].text;
        if (text === e1 || text === e2 || text === e3 || text === e4 || (!e1 && !e2 && !e3 && !e4)) {
            return this.tokens[0];
        }
    }
};
AST.prototype.parseArguments = function () {
    var args = [];
    if (!this.peek(")")) {
        do {
            args.push(this.assignment());
        } while (this.expect(","));
    }
    return args;
};
AST.prototype.assignment = function () {
    var left = this.ternary();
    if (this.expect("=")) {
        var right = this.ternary();
        return {
            type: AST.AssignmentExpression,
            left: left,
            right: right
        };
    }
    return left;
};
AST.prototype.unary = function () {
    var token;
    if ((token = this.expect("+", "!", "-"))) {
        return {
            type: AST.UnaryExpression,
            operator: token.text,
            argument: this.unary()
        };
    } else {
        return this.primary();
    }
};
AST.prototype.multiplicative = function () {
    var left = this.unary();
    var token;
    while ((token = this.expect("*", "/", "%"))) {
        left = {
            type: AST.BinaryExpression,
            left: left,
            operator: token.text,
            right: this.unary()
        };
    }
    return left;
};
AST.prototype.additive = function () {
    var left = this.multiplicative();
    var token;
    while ((token = this.expect("+")) || (token = this.expect("-"))) {
        left = {
            type: AST.BinaryExpression,
            left: left,
            operator: token.text,
            right: this.multiplicative()
        };
    }
    return left;
};
AST.prototype.relational = function () {
    var left = this.additive();
    var token;
    while ((token = this.expect("<", ">", "<=", ">="))) {
        left = {
            type: AST.BinaryExpression,
            left: left,
            operator: token.text,
            right: this.additive()
        };
    }
    return left;
};
AST.prototype.equality = function () {
    var left = this.relational();
    var token;
    while ((token = this.expect("==", "!=", "===", "!=="))) {
        left = {
            type: AST.BinaryExpression,
            left: left,
            operator: token.text,
            right: this.additive()
        };
    }
    return left;
};
AST.prototype.logicalAND = function () {
    var left = this.equality();
    var token;
    while ((token = this.expect("&&"))) {
        left = {
            type: AST.LogicalExpression,
            left: left,
            operator: token.text,
            right: this.equality()
        };
    }
    return left;
};
AST.prototype.logicalOR = function () {
    var left = this.logicalAND();
    var token;
    while ((token = this.expect("||"))) {
        left = {
            type: AST.LogicalExpression,
            left: left,
            operator: token.text,
            right: this.logicalAND()
        };
    }
    return left;
};
AST.prototype.ternary = function () {
    var test = this.logicalOR();
    if (this.expect("?")) {
        var consequent = this.assignment();
        if (this.consume(":")) {
            var alternate = this.assignment();
            return {
                type: AST.ConditionalExpression,
                test: test,
                consequent: consequent,
                alternate: alternate
            };
        }
    }
    return test;
};
function ASTCompiler(astBuilder) {
    this.astBuilder = astBuilder;
}
ASTCompiler.prototype.compile = function (text) {
    var ast = this.astBuilder.ast(text);
    console.log(ast);
    this.state = { body: [], nextId: 0, vars: [] };
    this.recurse(ast);
    var fnString = "var fn=function(s,l){" +
        (this.state.vars.length ?
            "var " + this.state.vars.join(",") + ";" :
            ""
        ) +
        this.state.body.join("") +
        "};return fn;"
    //return new Function("s", "l",
    //    (this.state.vars.length ?
    //        "var " + this.state.vars.join(",") + ";" :
    //        "")
    //    + this.state.body.join(""));
    return new Function(
        "ensureSafeMemberName",
        "ensureSafeObject",
        "ensureSafeFunction",
        "ifDefined",
        fnString)(
        ensureSafeMemberName,
        ensureSafeObject,
        ensureSafeFunction,
        ifDefined);
};
ASTCompiler.prototype.recurse = function (ast, context, create) {
    var _this = this;
    var intoId;
    switch (ast.type) {
        case AST.Program:
            this.state.body.push("return ", this.recurse(_.last(ast.body)), ";");
            break;
        case AST.Literal:
            return this.escape(ast.value);
        case AST.ArrayExpression:
            var elements = _.map(ast.elements, function (element) {
                return _this.recurse(element);
            });
            return "[" + elements.join(",") + "]";
        case AST.ObjectExpression:
            var properties = _.map(ast.properties, function (property) {
                var key = property.key.type === AST.Identifier ? property.key.name : _this.escape(property.key.value);
                var value = _this.recurse(property.value);
                return key + ":" + value;
            });
            return "{" + properties.join(",") + "}";
        case AST.Identifier:
            ensureSafeMemberName(ast.name);
            intoId = this.nextId();
            this.if_(this.getHasOwnProperty("l", ast.name),
                this.assign(intoId, this.nonComputedMember("l", ast.name)));
            if (create) {
                this.if_(this.not(this.getHasOwnProperty("l", ast.name)) +
                    " && s && " +
                    this.not(this.getHasOwnProperty("s", ast.name)),
                    this.assign(this.nonComputedMember("s", ast.name), "{}"));
            }
            this.if_(this.not(this.not(this.getHasOwnProperty("l", ast.name))) + " && s",
                this.assign(intoId, this.nonComputedMember("s", ast.name)));
            if (context) {
                context.context = this.getHasOwnProperty("l", ast.name) + "?l:s";
                context.name = ast.name;
                context.computed = false;
            }
            this.addEnsureSafeObject(intoId);
            return intoId;
        case AST.ThisExpression:
            return "s";
        case AST.MemberExpression:
            intoId = this.nextId();
            var left = this.recurse(ast.object, undefined, create);
            if (context) {
                context.context = left;
            }
            if (ast.computed) {
                var right = this.recurse(ast.property);
                this.addEnsureSafeMemberName(right);
                if (create) {
                    this.if_(this.not(this.computedMember(left, right)),
                        this.assign(this.computedMember(left, right)));
                }
                this.if_(left, this.assign(intoId,
                    "ensureSafeObject(" + this.computedMember(left, right) + ")"));
                if (context) {
                    context.name = right;
                    context.computed = true;
                }
            } else {
                ensureSafeMemberName(ast.property.name);
                if (create) {
                    this.if_(this.not(this.nonComputedMember(left, ast.property.name)),
                        this.assign(this.nonComputedMember(left, ast.property.name), "{}"));
                }
                this.if_(left, this.assign(intoId,
                    "ensureSafeObject(" + this.nonComputedMember(left, ast.property.name) + ")"));
                if (context) {
                    context.name = ast.property.name;
                    context.computed = false;
                }
            }
            return intoId;
        case AST.CallExpression:
            var callContext = {};
            var callee = this.recurse(ast.callee, callContext);
            var args = _.map(ast.arguments, function (arg) {
                return "ensureSafeObject(" + _this.recurse(arg) + ")";
            });
            if (callContext.name) {
                this.addEnsureSafeObject(callContext.context);
                if (callContext.computed) {
                    callee = this.computedMember(callContext.context, callContext.name);
                } else {
                    callee = this.nonComputedMember(callContext.context, callContext.name);
                }
            }
            this.addEnsureSafeFunction(callee);
            return callee + "&&ensureSafeObject(" + callee + "(" + args.join(",") + "))";
        case AST.AssignmentExpression:
            var leftContext = {};
            this.recurse(ast.left, leftContext, true);
            var leftExpr;
            if (leftContext.computed) {
                leftExpr = this.computedMember(leftContext.context, leftContext.name);
            } else {
                leftExpr = this.nonComputedMember(leftContext.context, leftContext.name);
            }
            return this.assign(leftExpr, "ensureSafeObject(" + this.recurse(ast.right) + ")");
        case AST.UnaryExpression:
            return ast.operator + "(" + this.ifDefined(this.recurse(ast.argument), 0) + ")";
        case AST.BinaryExpression:
            if (ast.operator === "+" || ast.operator === "-") {
                return "(" + this.ifDefined(this.recurse(ast.left), 0) + ")" +
                    ast.operator +
                    "(" + this.ifDefined(this.recurse(ast.right), 0) + ")";
            } else {
                return "(" + this.recurse(ast.left) + ")" +
                    ast.operator +
                    "(" + this.recurse(ast.right) + ")";
            }
            break;
        case AST.LogicalExpression:
            intoId = this.nextId();
            this.state.body.push(this.assign(intoId, this.recurse(ast.left)));
            this.if_(ast.operator === "&&" ? intoId : this.not(intoId),
                this.assign(intoid, this.recurse(ast.right)));
            return intoId;
        case AST.ConditionalExpression:
            intoId = this.nextId();
            var testId = this.nextId();
            this.state.body.push(this.assign(testId, this.recurse(ast.test)));
            this.if_(testId, this.assign(intoId, this.recurse(ast.consequent)));
            this.if_(this.not(testId), this.assign(intoId, this.recurse(ast.alternate)));
            return intoId;
    }
};
ASTCompiler.prototype.escape = function (value) {
    if (_.isString(value)) {
        return "\'" + value.replace(this.stringEscapeRegex, this.stringEscapeFn) + "\'";
    } else if (_.isNull(value)) {
        return "null";
    } else {
        return value;
    }
};
ASTCompiler.prototype.nonComputedMember = function (left, right) {
    return "(" + left + ")." + right;
};
ASTCompiler.prototype.computedMember = function (left, right) {
    return "(" + left + ")[" + right + "]";
};
ASTCompiler.prototype._if = function (test, consequent) {
    this.state.body.push("if(", test, "){", consequent, "}");
};
ASTCompiler.prototype.stringEscapeRegex = /[^ a-zA-Z0-9]/g;
ASTCompiler.prototype.stringEscapeFn = function (c) {
    return "\\u" + ("0000" + c.charCodeAt(0).toString()).slice(-4);
};
ASTCompiler.prototype.assign = function (id, value) {
    return id + "=" + value + ";";
};
ASTCompiler.prototype.nextId = function () {
    var id = "v" + (this.state.nextId++);
    this.state.vars.push(id);
    return id;
};
ASTCompiler.prototype.not = function (e) {
    return "!(" + e + ")";
};
ASTCompiler.prototype.getHasOwnProperty = function (object, property) {
    return object + "&&(" + this.escape(property) + " in " + object + ")";
};
ASTCompiler.prototype.addEnsureSafeMemberName = function (expr) {
    this.state.body.push("ensureSafeMemberName(" + expr + ");");
};
ASTCompiler.prototype.addEnsureSafeObject = function (expr) {
    this.state.body.push("ensureSafeObject(" + expr + ");");
};
ASTCompiler.prototype.addEnsureSafeFunction = function (expr) {
    this.state.body.push("ensureSafeFunction(" + expr + ");");
};
ASTCompiler.prototype.ifDefined = function (value, defaultValue) {
    return "ifDefined(" + value + "," + this.escape(defaultValue) + ")";
};
function Parser(lexer) {
    this.lexer = lexer;
    this.ast = new AST(this.lexer);
    this.astCompiler = new ASTCompiler(this.ast);
}
Parser.prototype.parse = function (text) {
    return this.astCompiler.compile(text);
};
var CALL = Function.prototype.call;
var APPLY = Function.prototype.apply;
var BIND = Function.prototype.bind;
function ensureSafeMemberName(name) {
    if (name === "constructor" || name === "__proto__" ||
        name === "__defineGetter__" || name === "__defineSetter__" ||
        name === "__lookupGetter__" || name === "__lookupSetter__") {
        throw "Attempting to access a disallowed field in Angular Expression!";
    }
}
function ensureSafeObject(obj) {
    if (obj) {
        if (obj.document && obj.location && obj.alert && obj.serInterval) {
            throw "Referencing window in angular expressions is disallowed!";
        } else if (obj.children && (obj.nodeName || (obj.prop && obj.attr && obj.find))) {
            throw "Referencing DOM nodes in angular expressions is disallowed!";
        } else if (obj.constructor === obj) {
            throw "Referencing Function in angular expressions is disallowed!";
        } else if (obj.getOwnPropertyNames || obj.getOwnPropertyDescriptor) {
            throw "Referencing Object in angular expressions is disallowed!";
        }
    }
    return obj;
}
function ensureSafeFunction(obj) {
    if (obj) {
        if (obj.constructor === obj) {
            throw "Referencing Function in angular expressions is disallowed!";
        } else if (obj == CALL || obj == APPLY || obj == BIND) {
            throw "Referencing call, apply, or bind in angular expressions is disallowed!";
        }
    }
    return obj;
}
function ifDefined(value, defaultValue) {
    return typeof value === "undefined" ? defaultValue : value;
}
//DI
function setupModuleLoader(window) {
    var angular = (window.angular = window.angular || {});
}