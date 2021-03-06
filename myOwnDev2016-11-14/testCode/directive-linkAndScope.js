/**
 * Created by lenovo on 2017/3/6-9:10.
 */
function $CompileProvider($provide) {
    var hasDirectives = {};

    this.directive = function(name, directiveFactory) {
        // directive可以通过
        //      module.directive("aaa", function(){})
        // 来调用

        // 也可以通过
        // module.directive({
        //      a: function() {},
        //      b: function() {},
        //      c: function() {},
        // })
        // 来创建多个指令
        if (_.isString(name)) {
            if (name === 'hasOwnProperty') {
                throw 'hasOwnProperty is not a valid directive name';
            }

            // $provide.factory(name + 'Directive', directiveFactory);
            // 同名的directive可以有多个，因为directive可以用于元素、属性、类名、注释等
            if (!hasDirectives.hasOwnProperty(name)) {
                hasDirectives[name] = [];
                $provide.factory(name + 'Directive', ['$injector', function ($injector) {
                    // 等将来该函数被调用时factories里面会有很多项
                    var factories = hasDirectives[name];
                    // return _.map(factories, $injector.invoke);
                    return _.map(factories, function(factory, i) {
                        var directive = $injector.invoke(factory);
                        directive.restrict = directive.restrict || 'EA';
                        // priority默认为0
                        directive.priority = directive.priority || 0;
                        // 使用外部传进来的link而不使用compile返回来的link
                        if (directive.link && !directive.compile) {
                            directive.compile = _.constant(directive.link);
                        }
                        // name用于在priority属性值相同时的比较
                        directive.name = directive.name || name;
                        // index用于在priority和name值都相同时的比较
                        directive.index = i;
                        return directive;
                    });
                }]);
            }
            hasDirectives[name].push(directiveFactory);
        } else {
            _.forEach(name, function(directiveFactory, name) {
                this.directive(name, directiveFactory);
            }, this);
        }
    };
    this.$get = ["$injector", "$rootScope", function($injector, $rootScope) {
        function Attributes(element) {
            this.$$element = element;
            // $attr的格式：
            // {
            //     "myDir": "x-my-dir"
            // }
            this.$attr = {};
        }
        // 第3个参数writeAttr代表key属性是否拥有写权限
        // 第4个参数attrName代表将要附加到DOM对象上带有横划线的属性名
        Attributes.prototype.$set = function(key, value, writeAttr, attrName) {
            // 修改实例对象的值 通过attrs.attr来访问
            this[key] = value;

            if (isBooleanAttribute(this.$$element[0], key)) {
                this.$$element.prop(key, value);
            }

            if (!attrName) {
                // attrName = key;
                // attrName = _.kebabCase(key, '-');
                if (this.$attr[key]) {
                    attrName = this.$attr[key];
                } else {
                    attrName = this.$attr[key] = _.kebabCase(key);
                }
            } else {
                this.$attr[key] = attrName;
            }

            if (writeAttr !== false) {
                // 修改DOM对象上的值，通过$ele.attr('attr')来访问
                // this.$$element.attr(key, value);
                this.$$element.attr(attrName, value);
            }

            if (this.$$observers) {
                _.forEach(this.$$observers[key], function(observer) {
                    try {
                        observer(value);
                    } catch (e) {
                        console.log(e);
                    }
                });
            }
        };
        // $$observers
        Attributes.prototype.$observe = function(key, fn) {
            var self = this;
            this.$$observers = this.$$observers || Object.create(null);
            this.$$observers[key] = this.$$observers[key] || [];
            this.$$observers[key].push(fn);
            $rootScope.$evalAsync(function() {
                fn(self[key]);
            });
            return function() {
                var index = self.$$observers[key].indexOf(fn);
                if (index >= 0) {
                    self.$$observers[key].splice(index, 1);
                }
            };
        };
        Attributes.prototype.$addClass = function(classVal) {
            this.$$element.addClass(classVal);
        };
        Attributes.prototype.$removeClass = function(classVal) {
            this.$$element.removeClass(classVal);
        };
        Attributes.prototype.$updateClass = function(newClassVal, oldClassVal) {
            var newClasses = newClassVal.split(/\s+/);
            var oldClasses = oldClassVal.split(/\s+/);
            var addedClasses = _.difference(newClasses, oldClasses);
            var removedClasses = _.difference(oldClasses, newClasses);
            if (addedClasses.length) {
                this.$addClass(addedClasses.join(' '));
            }
            if (removedClasses.length) {
                this.$removeClass(removedClasses.join(' '));
            }
        };
        var PREFIX_REGEXP = /(x[\:\-_]|data[\:\-_])/i;
        var BOOLEAN_ATTRS = {
            multiple: true,
            selected: true,
            checked: true,
            disabled: true,
            readOnly: true,
            required: true,
            open: true
        };
        var BOOLEAN_ELEMENTS = {
            INPUT: true,
            SELECT: true,
            OPTION: true,
            TEXTAREA: true,
            BUTTON: true,
            FORM: true,
            DETAILS: true
        };
        // $compileNodes是一个jquery封装的DOM对象
        function compile($compileNodes) {
            // return compileNodes($compileNodes);
            // compileNodes将返回link函数
            var compositeLinkFn = compileNodes($compileNodes);
            return function publicLinkFn(scope) {
                // 编译
                $compileNodes.data('$scope', scope);
                // 链接
                compositeLinkFn(scope, $compileNodes);
            };
        }
        // 根节点下的所有子节点都有一个link函数nodeLinkFn，同时也有一个总的link函数compositeLinkFn(用于将所有的node)
        // linkFns存储所有子节点的link函数nodeLinkFn
        function compileNodes($compileNodes) {
            var linkFns = [];
            _.forEach($compileNodes, function(node, i) {
                // 为了后期拿属性方便，专门开一个参数存储节点的属性
                // var attrs = {};
                // 由于attrs对象可能会有很多自定义的属性和方法，因此单开了一个构造函数来创建该对象
                var attrs = new Attributes($(node));
                var directives = collectDirectives(node, attrs);
                var nodeLinkFn;
                // 阻止遍历子节点
                // var terminal = applyDirectivesToNode(directives, node, attrs);
                if (directives.length) {
                    nodeLinkFn = applyDirectivesToNode(directives, node, attrs);
                }
                var childLinkFn;
                // 递归遍历所有DOM节点
                // if (node.childNodes && node.childNodes.length) {
                // if (!terminal && node.childNodes && node.childNodes.length) {
                if ((!nodeLinkFn || !nodeLinkFn.terminal) && node.childNodes && node.childNodes.length) {
                    childLinkFn = compileNodes(node.childNodes);
                }
                // 如果遍历到的节点上绑定的指令设置了隔离作用域，加上ng-scope类来标识
                if (nodeLinkFn && nodeLinkFn.scope) {
                    attrs.$$element.addClass('ng-scope');
                }
                if (nodeLinkFn || childLinkFn) {
                    linkFns.push({
                        nodeLinkFn: nodeLinkFn,
                        childLinkFn: childLinkFn,
                        idx: i
                    });
                }
            });
            function compositeLinkFn(scope, linkNodes) {
                // stableNodeList存储最原始的（link执行之前的）dom结构，避免在link的过程中对DOM的增删改对接下来的编译 链接造成影响
                var stableNodeList = [];
                _.forEach(linkFns, function(linkFn) {
                    var nodeIdx = linkFn.idx;
                    stableNodeList[nodeIdx] = linkNodes[nodeIdx];
                });
                _.forEach(linkFns, function(linkFn) {
                    var node = stableNodeList[linkFn.idx];
                    // 如果当前节点没有link方法，则遍历其子节点
                    if (linkFn.nodeLinkFn) {
                        if (linkFn.nodeLinkFn.scope) {
                            scope = scope.$new();
                            $(node).data('$scope', scope);
                        }
                        // linkFn.nodeLinkFn(scope, linkNodes[linkFn.idx]);
                        linkFn.nodeLinkFn(
                            linkFn.childLinkFn,
                            scope,
                            // linkNodes[linkFn.idx]
                            node
                        );
                    } else {
                        linkFn.childLinkFn(
                            scope,
                            // linkNodes[linkFn.idx].childNodes
                            node.childNodes
                        );
                    }
                });
            }
            return compositeLinkFn;
        }
        // directives拿到的是在Angular module对象上注册的directive函数
        // 这个函数里面的linkFns存储每个元素节点上的指令的链接函数
        function applyDirectivesToNode(directives, compileNode, attrs) {
            var $compileNode = $(compileNode);
            var terminalPriority = -Number.MAX_VALUE;
            var terminal = false;
            // var linkFns = [];
            var preLinkFns = [], postLinkFns = [];
            // 在当前节点上绑定的所有指令中只要有任意一个有继承作用域，newScopeDirective就会被赋值为有继承作用域的这个指令，此后的循环中如果又有指令拥有继承作用域，将会被忽略
            var newScopeDirective;

            function addLinkFns(preLinkFn, postLinkFn, attrStart, attrEnd) {
                if (preLinkFn) {
                    if (attrStart) {
                        preLinkFn = groupElementsLinkFnWrapper(preLinkFn, attrStart, attrEnd);
                    }
                    preLinkFns.push(preLinkFn);
                }
                if (postLinkFn) {
                    if (attrStart) {
                        postLinkFn = groupElementsLinkFnWrapper(postLinkFn, attrStart, attrEnd);
                    }
                    postLinkFns.push(postLinkFn);
                }
            }

            _.forEach(directives, function(directive) {
                if (directive.$$start) {
                    $compileNode = groupScan(compileNode, directive.$$start, directive.$$end);
                }
                // 优先级值小于终止优先级的指令不参与编译
                if (directive.priority < terminalPriority) {
                    return false;
                }
                if (directive.scope) {
                    newScopeDirective = newScopeDirective || directive;
                }
                if (directive.compile) {
                    // directive.compile($compileNode, attrs);
                    var linkFn = directive.compile($compileNode, attrs);
                    var attrStart = directive.$$start;
                    var attrEnd = directive.$$end;
                    if (_.isFunction(linkFn)) {
                        // linkFns.push(linkFn);
                        // postLinkFns.push(linkFn);
                        addLinkFns(null, linkFn, attrStart, attrEnd);
                    } else if (linkFn) {
                        // linkFn是对象的情况，该对象可能包含post和pre两个方法
                        // linkFns.push(linkFn.post);
                        // if (linkFn.pre) {
                        //     preLinkFns.push(linkFn.pre);
                        // }
                        // if (linkFn.post) {
                        //     postLinkFns.push(linkFn.post);
                        // }
                        addLinkFns(linkFn.pre, linkFn.post, attrStart, attrEnd);
                    }
                }
                // 当某个指令有terminal属性且值为true时，该节点及其子节点均不参加编译
                if (directive.terminal) {
                    terminal = true;
                    terminalPriority = directive.priority;
                }
            });
            // return terminal;
            function nodeLinkFn(childLinkFn, scope, linkNode) {
                var $element = $(linkNode);

                _.forEach(preLinkFns, function(linkFn) {
                    linkFn(scope, $element, attrs);
                });

                if (childLinkFn) {
                    childLinkFn(scope, linkNode.childNodes);
                }
                _.forEachRight(postLinkFns, function(linkFn) {
                    var $element = $(linkNode);
                    linkFn(scope, $element, attrs);
                });
            }
            nodeLinkFn.terminal = terminal;
            nodeLinkFn.scope = newScopeDirective && newScopeDirective.scope;
            return nodeLinkFn;
        }
        function groupScan(node, startAttr, endAttr) {
            var nodes = [];
            if (startAttr && node && node.hasAttribute(startAttr)) {
                var depth = 0;
                do {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.hasAttribute(startAttr)) {
                            depth++;
                        } else if (node.hasAttribute(endAttr)) {
                            depth--;
                        }
                    }
                    nodes.push(node);
                    node = node.nextSibling;
                } while (depth > 0);
            } else {
                nodes.push(node);
            }
            return $(nodes);
        }
        function groupElementsLinkFnWrapper(linkFn, attrStart, attrEnd) {
            return function(scope, element, attrs) {
                var group = groupScan(element[0], attrStart, attrEnd);
                return linkFn(scope, group, attrs);
            };
        }
        // node是原生DOM对象
        function collectDirectives(node, attrs) {
            var directives = [];
            var match;
            if (node.nodeType === Node.ELEMENT_NODE) {
                // var normalizedNodeName = _.camelCase(nodeName(node).toLowerCase());
                var normalizedNodeName = directiveNormalize(nodeName(node).toLowerCase());
                // 从注册的指令中提取出元素指令
                addDirective(directives, normalizedNodeName, 'E');
                // 从注册的指令中提取出属性指令
                _.forEach(node.attributes, function (attr) {
                    var attrStartName, attrEndName;
                    var name = attr.name;
                    var normalizedAttrName = directiveNormalize(name.toLowerCase());
                    var isNgAttr = /^ngAttr[A-Z]/.test(normalizedAttrName);
                    if (isNgAttr) {
                        // normalizedAttrName =
                        //     normalizedAttrName[6].toLowerCase() +
                        //     normalizedAttrName.substring(7);
                        // 工具方法kebabCase将驼峰形式转换为横划线格式
                        name = _.kebabCase(
                            normalizedAttrName[6].toLowerCase() +
                            normalizedAttrName.substring(7)
                        );
                        normalizedAttrName = directiveNormalize(name.toLowerCase());
                    }
                    attrs.$attr[normalizedAttrName] = name;
                    var directiveNName = normalizedAttrName.replace(/(Start|End)$/, '');
                    if (directiveIsMultiElement(directiveNName)) {
                        if (/Start$/.test(normalizedAttrName)) {
                            // attrStartName = normalizedAttrName;
                            // attrEndName =
                            //     normalizedAttrName.substring(0, normalizedAttrName.length - 5) + 'End';
                            // normalizedAttrName =
                            //     normalizedAttrName.substring(0, normalizedAttrName.length - 5);
                            attrStartName = name;
                            attrEndName = name.substring(0, name.length - 5) + 'end';
                            name = name.substring(0, name.length - 6);
                        }
                    }
                    normalizedAttrName = directiveNormalize(name.toLowerCase());
                    addDirective(directives, normalizedAttrName, 'A', attrStartName, attrEndName);
                    // 对于重复在元素上注册的同名属性，带有ng-attr前缀的属性的值会覆盖不带ng-attr前缀的属性的值
                    if (isNgAttr || !attrs.hasOwnProperty(normalizedAttrName)) {
                        // 将属性及其值扩展到attrs上，进而在$compile方法执行时作为参数传递进去
                        attrs[normalizedAttrName] = attr.value.trim();
                        // 对于值为Boolean类型的属性做处理
                        if (isBooleanAttribute(node, normalizedAttrName)) {
                            attrs[normalizedAttrName] = true;
                        }
                    }
                });
                // 从注册的指令中提取出样式指令
                var className = node.className;
                if (_.isString(className) && !_.isEmpty(className)) {
                    while ((match = /([\d\w\-_]+)(?:\:([^;]+))?;?/.exec(className))) {
                        var normalizedClassName = directiveNormalize(match[1]);
                        if (addDirective(directives, normalizedClassName, 'C')) {
                            attrs[normalizedClassName] = match[2] ? match[2].trim() : undefined;
                        }
                        className = className.substr(match.index + match[0].length);
                    }
                }
                // _.forEach(node.classList, function (cls) {
                //     var normalizedClassName = directiveNormalize(cls);
                //     // addDirective(directives, normalizedClassName, 'C');
                //     // 通过module注册过的directive存到attrs中才有意义
                //     if (addDirective(directives, normalizedClassName, 'C')) {
                //         attrs[normalizedClassName] = undefined;
                //     }
                // });
            } else if (node.nodeType === Node.COMMENT_NODE) {
                // 从注册的指令中提取出注释指令
                // match = /^\s*directive\:\s*([\d\w\-_]+)/.exec(node.nodeValue);
                match = /^\s*directive\:\s*([\d\w\-_]+)\s*(.*)$/.exec(node.nodeValue);
                if (match) {
                    // addDirective(directives, directiveNormalize(match[1]), 'M');
                    var normalizedName = directiveNormalize(match[1]);
                    if (addDirective(directives, normalizedName, 'M')) {
                        attrs[normalizedName] = match[2] ? match[2].trim() : undefined;
                    }
                }
            }
            directives.sort(byPriority);
            return directives;
        }
        function isBooleanAttribute(node, attrName) {
            return BOOLEAN_ATTRS[attrName] && BOOLEAN_ELEMENTS[node.nodeName];
        }
        function directiveIsMultiElement(name) {
            if (hasDirectives.hasOwnProperty(name)) {
                var directives = $injector.get(name + 'Directive');
                return _.any(directives, {multiElement: true});
            }
            return false;
        }
        function byPriority(a, b) {
            var diff = b.priority - a.priority;
            if (diff !== 0) {
                return diff;
            } else {
                if (a.name !== b.name) {
                    return (a.name < b.name ? -1 : 1);
                } else {
                    return a.index - b.index;
                }
            }
        }
        function directiveNormalize(name) {
            return _.camelCase(name.replace(PREFIX_REGEXP, ''));
        }
        // element既可以是原生DOM对象，也可以是jqueryDOM对象
        function nodeName(element) {
            return element.nodeName ? element.nodeName : element[0].nodeName;
        }
        function addDirective(directives, name, mode, attrStartName, attrEndName) {
            var match;
            if (hasDirectives.hasOwnProperty(name)) {
                // directives.push.apply(directives, $injector.get(name + 'Directive'));
                var foundDirectives = $injector.get(name + 'Directive');
                // 将对应模式的指令筛选出来再放到directives数组中
                var applicableDirectives = _.filter(foundDirectives, function(dir) {
                    return dir.restrict.indexOf(mode) !== -1;
                });
                // directives.push.apply(directives, applicableDirectives);
                _.forEach(applicableDirectives, function(directive) {
                    if (attrStartName) {
                        directive = _.create(directive, {
                            $$start: attrStartName,
                            $$end: attrEndName
                        });
                    }
                    directives.push(directive);
                    match = directive;
                });
            }
            return match;
        }
        return compile;
    }];
}
$CompileProvider.$inject = ['$provide'];