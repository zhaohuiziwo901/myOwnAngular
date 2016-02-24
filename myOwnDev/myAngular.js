(function () {
    function Scope() {
        //双$符号代表是私有属性
        this.$$watchers = [];
        this.$$lastDirtyWatch = null;
        this.$$asyncQueue = [];
        this.$$applyAsyncQueue = [];
        this.$$applyAsyncId = null;
        this.$$postDigestQueue = [];
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
        this.$$lastDirtyWatch = null;
        return function () {
            var index = self.$$watchers.indexOf(watcher);
            if (index >= 0) {
                self.$$watchers.splice(index, 1);
                //防止在$digestOnce中遍历所有的watcher时其中某一个watcher的listener中删掉其他watcher的情况
                self.$$lastDirtyWatch = null;
            }
        };
    };
    Scope.prototype.$$digestOnce = function () {
        var self = this;
        var newValue;
        var oldValue;
        var dirty;
        _.forEachRight(this.$$watchers, function (watcher) {
            try {
                //判断watcher是否存在是因为有可能在$digest循环watcher的过程中某一个watcher在其监听函数中会将所有的this.$$watchers里面所有的watcher全部删掉
                if (watcher) {
                    newValue = watcher.watchFn(self);
                    oldValue = watcher.last;
                    //if (newValue !== oldValue) {
                    if (!self.$$areEqual(newValue, oldValue, watcher.valueEq)) {
                        self.$$lastDirtyWatch = watcher;
                        //watcher.last = newValue;
                        watcher.last = watcher.valueEq ? _.cloneDeep(newValue) : newValue;
                        watcher.listenerFn(
                            newValue,
                            (oldValue == initWatchVal ? newValue : oldValue),
                            self
                        );
                        dirty = true;
                    } else if (self.$$lastDirtyWatch === watcher) {
                        return false;
                    }
                }
            } catch (e) {
                console.error(e);
            }
        });
        return dirty;
    };
    Scope.prototype.$digest = function () {
        var ttl = 10;//ttl means Time To Live
        var dirty;
        this.$$lastDirtyWatch = null;
        this.$beginPhase("$digest");

        if (this.$$applyAsyncId) {
            clearTimeout(this.$$applyAsyncId);
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
            return newValue === oldValue || (
                typeof newValue === "number" &&
                typeof oldValue === "number" &&
                isNaN(newValue) &&
                isNaN(oldValue)
            );
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
            this.$digest();
        }
    };
    Scope.prototype.$evalAsync = function (expr) {
        var self = this;
        if (!self.$$phase && !self.$$asyncQueue.length) {
            setTimeout(function () {
                if (self.$$asyncQueue.length) {
                    self.$digest();
                }
            }, 0);
        }
        self.$$asyncQueue.push({
            scope: self,
            expression: expr
        });
    };
    Scope.prototype.$beginPhase = function (phase) {
        if (this.$$phase) {
            throw this.$$phase + " already in progress";
        }
        this.$$phase = phase;
    };
    Scope.prototype.$clearPhase = function () {
        this.$$phase = null;
    };
    Scope.prototype.$applyAsync = function (expr) {
        var self = this;
        self.$$applyAsyncQueue.push(function () {
            self.$eval(expr);
        });
        if (self.$$applyAsyncId === null) {
            self.$$applyAsyncId = setTimeout(function () {
                //self.$apply(function () {
                //    while (self.$$applyAsyncQueue.length) {
                //        self.$$applyAsyncQueue.shift()();
                //    }
                //    self.$$applyAsyncId = null;
                //});
                //_.bind() 第一个参数是要绑定的函数，第二个参数是函数里面的this指向
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
        this.$$applyAsyncId = null;
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
            changeReactionScheduled = false;
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

    function initWatchVal() { }

    window.Scope = Scope;
})();
